package app.focussimulator.guard;

import android.accessibilityservice.AccessibilityService;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Which app is in front, how long it stays there, and — for the rules that
 * block websites — which site a browser is showing.
 *
 * <p><b>Why an accessibility service.</b> It is the only thing on Android that is
 * told, promptly and without polling, that a different app has come to the front.
 * UsageStatsManager answers the same question about the recent past, so a blocker
 * built on it lets you into the app for a second or two first - which is the
 * second or two that matters. This is the mechanism ScreenZen uses too.
 *
 * <p><b>What it reads, exactly.</b> The package of the window in front, always.
 * The text of a browser's address bar, found by its view id, only while a rule
 * blocks a website. The words on a Settings screen, only while the lock is on,
 * and only to recognise the handful of screens that would switch the blocker
 * off. Nothing is stored except the host and the seconds; nothing is sent
 * anywhere. The permission text in strings.xml says the same, in fewer words.
 *
 * <p><b>It needs the overlay permission to work.</b> Not to draw: since Android 10
 * a background app may not start an activity, and holding SYSTEM_ALERT_WINDOW is
 * the exemption. Without it the shield silently never appears.
 */
public class BlockService extends AccessibilityService {

    /** Enough to swallow the flurry of window events one app launch produces. */
    private static final long SETTLE_MS = 800;
    /** How often to look again while something covered by a rule is in front. */
    private static final long WATCH_MS = 4000;
    /** How often an address bar is read, at most, while a browser is busy. */
    private static final long BAR_MS = 700;
    /** Seconds are written in batches this big, not on every beat. */
    private static final long FLUSH_MS = 15_000;

    /* Browsers and where each keeps its address bar. Best effort by nature: a
       browser update can rename the view, and one that is not on this list is
       one whose sites cannot be blocked. Firefox has used both ids. */
    private static final Map<String, String[]> BARS = new HashMap<>();
    static {
        String[] chromium = {"com.android.chrome", "com.chrome.beta", "com.chrome.dev",
                "com.chrome.canary", "org.chromium.chrome", "com.brave.browser",
                "com.microsoft.emmx", "com.kiwibrowser.browser", "com.vivaldi.browser"};
        for (String p : chromium) BARS.put(p, new String[]{p + ":id/url_bar"});
        for (String p : new String[]{"org.mozilla.firefox", "org.mozilla.firefox_beta",
                "org.mozilla.fenix", "org.mozilla.focus"}) {
            BARS.put(p, new String[]{p + ":id/mozac_browser_toolbar_url_view", p + ":id/url_bar_title"});
        }
        BARS.put("com.sec.android.app.sbrowser",
                new String[]{"com.sec.android.app.sbrowser:id/location_bar_edit_text"});
        BARS.put("com.opera.browser", new String[]{"com.opera.browser:id/url_field"});
        BARS.put("com.opera.mini.native", new String[]{"com.opera.mini.native:id/url_field"});
        BARS.put("com.duckduckgo.mobile.android",
                new String[]{"com.duckduckgo.mobile.android:id/omnibarTextInput"});
    }

    private final Handler hand = new Handler(Looper.getMainLooper());
    /* Windows that come and go over an app without anybody leaving it: the
       notification shade, the keyboard. Switching "front" to them would stop the
       clock on the app underneath and never start it again. */
    private final Set<String> passing = new HashSet<>();
    private String launcher = "";

    private String front = "";
    private long frontAt = 0;
    /** What the seconds are going to: the package, or site:entry while a blocked site is showing. */
    private String target = "";
    private long since = 0;
    private String siteHost = "";
    private long barAt = 0;
    private boolean screenOn = true;

    private final Runnable watch = new Runnable() {
        @Override
        public void run() {
            if (TextUtils.isEmpty(front) || !screenOn) return;
            bank(false);
            /* Three things turn a permitted app into a blocked one with no window
               changing: an allowance running out, the daily minutes running out,
               and a rule coming into force while you are already in the app. None
               produces an event, so while a covered app is in front - and only
               then - the question is asked again on a slow beat. */
            decide(true);
        }
    };

    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            String a = i == null ? "" : String.valueOf(i.getAction());
            if (Intent.ACTION_SCREEN_OFF.equals(a)) {
                bank(true);
                screenOn = false;
                hand.removeCallbacks(watch);
            } else if (Intent.ACTION_USER_PRESENT.equals(a)) {
                /* Unlocking back into an app often fires no window event at all,
                   so the front is read afresh — and decided afresh, because an
                   allowance may have run out while the phone was in a pocket. */
                screenOn = true;
                since = SystemClock.elapsedRealtime();
                String pkg = rootPackage();
                if (!TextUtils.isEmpty(pkg) && !ignored(pkg)) arrive(pkg);
            }
        }
    };

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        passing.add("com.android.systemui");
        passing.add("android");
        passing.add(getPackageName());
        try {
            String ime = Settings.Secure.getString(getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD);
            ComponentName cn = ime == null ? null : ComponentName.unflattenFromString(ime);
            if (cn != null) passing.add(cn.getPackageName());
        } catch (Exception ignored) {}
        try {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            ResolveInfo ri = getPackageManager().resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
            if (ri != null && ri.activityInfo != null) launcher = ri.activityInfo.packageName;
        } catch (Exception ignored) {}
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_USER_PRESENT);
        try {
            ContextCompat.registerReceiver(this, screen, f, ContextCompat.RECEIVER_NOT_EXPORTED);
        } catch (Exception ignored) {}
    }

    private boolean ignored(String pkg) {
        return passing.contains(pkg);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null || e.getPackageName() == null) return;
        String pkg = e.getPackageName().toString();
        int type = e.getEventType();

        /* The shield is ours, so its own appearance is not an app coming to the
           front — but it does stop the seconds going to the app it is covering. */
        if (pkg.equals(getPackageName())) {
            if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                bank(true);
                /* Front is cleared, not just the target: going back into the
                   same app from the shield has to count as arriving, or a quick
                   "open for" lands inside the settle window, is dropped as a
                   repeat, and the time in the app is never counted. */
                front = "";
                target = "";
                hand.removeCallbacks(watch);
            }
            return;
        }

        if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            if (!pkg.equals(front)) return;
            if (BARS.containsKey(pkg)) readBar(pkg);
            else if (isSettings(pkg)) guardSettings(pkg, "");
            return;
        }
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        if (ignored(pkg)) return;

        String cls = e.getClassName() == null ? "" : e.getClassName().toString();
        if (isSettings(pkg) && guardSettings(pkg, cls)) return;

        long now = System.currentTimeMillis();
        if (pkg.equals(front) && now - frontAt < SETTLE_MS) return;
        frontAt = now;
        arrive(pkg);
    }

    /** A different app is in front. */
    private void arrive(String pkg) {
        bank(true);
        front = pkg;
        target = pkg;
        since = SystemClock.elapsedRealtime();
        siteHost = "";
        barAt = 0;
        decide(false);
    }

    /* ---------------- the decision ---------------- */

    private GuardRules.Match currentMatch(JSONObject cfg) {
        if (target.startsWith(GuardRules.SITE) && !siteHost.isEmpty()) {
            return GuardRules.matchSite(cfg, siteHost);
        }
        return GuardRules.matchApp(cfg, front);
    }

    private void decide(boolean fromWatch) {
        hand.removeCallbacks(watch);
        JSONObject cfg = GuardStore.config(this);
        GuardRules.Match m = currentMatch(cfg);
        /* **Arriving at something a rule covers is an open, whether or not it
           was stopped.** The counts up to now only existed on the far side of
           the shield -- "shown", "through", "closed" -- so an app you are
           blocking outside a session, or during one you have already been let
           through, left no trace at all. A rule you cannot see the weight of is
           a rule you cannot judge, and "how often do I actually reach for this"
           is the question the screen is for.

           Only on arrival. `decide` also runs on the watch beat, every few
           seconds for as long as the app stays in front, and counting there
           would turn one open into a hundred. */
        if (m != null && !fromWatch) GuardStore.add(this, m.target, "opens", 1);
        gray(m != null && cfg.optBoolean("on", false) && inForce(m));
        /* Nothing covered is in front, so there is nothing to watch: a browser
           moving to a blocked site is noticed by its address bar changing, not
           by a beat. */
        if (m == null) return;
        GuardRules.Verdict v = GuardStore.verdict(this, m);
        if (v.shield) {
            long had = GuardStore.allowances(this).optLong(m.target, 0);
            boolean up = fromWatch && had > 0 && had <= System.currentTimeMillis();
            shield(m, up);
        } else {
            hand.postDelayed(watch, WATCH_MS);
        }
    }

    private boolean inForce(GuardRules.Match m) {
        Calendar cal = Calendar.getInstance();
        return GuardRules.inForce(m.rule, GuardStore.timer(this),
                cal.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY,
                cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE));
    }

    private void shield(GuardRules.Match m, boolean up) {
        hand.removeCallbacks(watch);
        bank(true);
        Intent i = new Intent(this, ShieldActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TASK
                        | Intent.FLAG_ACTIVITY_NO_ANIMATION)
                .putExtra("pkg", front)
                .putExtra("host", target.startsWith(GuardRules.SITE) ? siteHost : "")
                .putExtra("up", up);
        try { startActivity(i); } catch (Exception ignored) {}
    }

    /* ---------------- the seconds ---------------- */

    /**
     * Put the time the current target has been in front into today's counts.
     * In batches, not on every beat: the history is one JSON string and writing
     * it every four seconds for the length of an evening is work for nothing.
     * {@code all} flushes whatever there is, for the moments the target changes.
     */
    private void bank(boolean all) {
        if (TextUtils.isEmpty(target) || !screenOn || since == 0) return;
        long now = SystemClock.elapsedRealtime();
        long ms = now - since;
        if (ms < 0) { since = now; return; }
        if (!all && ms < FLUSH_MS) return;
        int secs = (int) (ms / 1000);
        if (secs <= 0) return;
        if (!target.equals(launcher)) GuardStore.add(this, target, "secs", secs);
        since += secs * 1000L;
    }

    /* ---------------- websites ---------------- */

    private void readBar(String pkg) {
        long now = SystemClock.elapsedRealtime();
        if (now - barAt < BAR_MS) return;
        barAt = now;
        JSONObject cfg = GuardStore.config(this);
        if (!cfg.optBoolean("on", false) || !GuardRules.anySites(cfg)) return;
        String host = GuardRules.host(barText(pkg));
        /* **No address is not a new address.** Browsers hide the bar while you
           scroll, and a page with no bar on it is still the page you were on. */
        if (host.isEmpty() || host.equals(siteHost)) return;
        bank(true);
        siteHost = host;
        GuardRules.Match m = GuardRules.matchSite(cfg, host);
        target = m != null ? m.target : pkg;
        since = SystemClock.elapsedRealtime();
        decide(false);
    }

    private String barText(String pkg) {
        String[] ids = BARS.get(pkg);
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (ids == null || root == null) return "";
        for (String id : ids) {
            try {
                List<AccessibilityNodeInfo> found = root.findAccessibilityNodeInfosByViewId(id);
                if (found != null && !found.isEmpty() && found.get(0).getText() != null) {
                    return found.get(0).getText().toString();
                }
            } catch (Exception ignored) {}
        }
        return "";
    }

    /* ---------------- the lock ---------------- */

    private static boolean isSettings(String pkg) {
        return "com.android.settings".equals(pkg) || pkg.endsWith(".packageinstaller");
    }

    /**
     * While the lock is on, the screens that would switch the blocker off are
     * blocked too: turning off device admin (which is what lets it be
     * uninstalled), the uninstall confirmation, this app's info page, and the
     * accessibility page for this service.
     *
     * <p><b>Best effort, and said so.</b> Settings screens are recognised by the
     * class that opens them where that is stable, and otherwise by this app's
     * name appearing on them, which every manufacturer's Settings shows. It will
     * miss a screen some phone draws differently; it is not a security boundary,
     * it is the friction ScreenZen's lock is, and safe mode gets past both.
     */
    private boolean guardSettings(String pkg, String cls) {
        JSONObject cfg = GuardStore.config(this);
        if (!GuardRules.locked(cfg)) return false;
        if (cls.contains("DeviceAdminAdd")) return lockShield(pkg, "admin");
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        String app = String.valueOf(getApplicationInfo().loadLabel(getPackageManager()));
        String service = getString(R.string.guard_service_label);
        if (pkg.endsWith(".packageinstaller") && has(root, app)) return lockShield(pkg, "uninstall");
        if (has(root, service)) return lockShield(pkg, "service");
        if (has(root, app) && (has(root, "Force stop") || has(root, "Uninstall"))) {
            return lockShield(pkg, "info");
        }
        return false;
    }

    private static boolean has(AccessibilityNodeInfo root, String text) {
        try {
            List<AccessibilityNodeInfo> f = root.findAccessibilityNodeInfosByText(text);
            return f != null && !f.isEmpty();
        } catch (Exception e) {
            return false;
        }
    }

    private boolean lockShield(String pkg, String kind) {
        bank(true);
        front = pkg;
        target = "";
        Intent i = new Intent(this, ShieldActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TASK
                        | Intent.FLAG_ACTIVITY_NO_ANIMATION)
                .putExtra("pkg", pkg)
                .putExtra("lock", kind);
        try { startActivity(i); } catch (Exception ignored) {}
        return true;
    }

    /* ---------------- grayscale ---------------- */

    /**
     * The colour filter on while a blocked thing is in front. Needs
     * WRITE_SECURE_SETTINGS, which only adb can grant (see ANDROID.md); without
     * it the write throws and this quietly does nothing, which is also what the
     * page says.
     */
    private void gray(boolean want) {
        JSONObject cfg = GuardStore.config(this);
        if (!cfg.optBoolean("gray", false)) want = false;
        boolean ours = GuardStore.grayOurs(this);
        if (want == ours) return;
        ContentResolver cr = getContentResolver();
        try {
            if (want) {
                if (Settings.Secure.getInt(cr, "accessibility_display_daltonizer_enabled", 0) == 1) return;
                Settings.Secure.putInt(cr, "accessibility_display_daltonizer", 0);
                Settings.Secure.putInt(cr, "accessibility_display_daltonizer_enabled", 1);
            } else {
                Settings.Secure.putInt(cr, "accessibility_display_daltonizer_enabled", 0);
            }
            GuardStore.setGrayOurs(this, want);
        } catch (Exception ignored) {}
    }

    /* ---------------- the rest ---------------- */

    private String rootPackage() {
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            return root == null || root.getPackageName() == null ? "" : root.getPackageName().toString();
        } catch (Exception e) {
            return "";
        }
    }

    @Override
    public void onInterrupt() {}

    @Override
    public boolean onUnbind(Intent intent) {
        bank(true);
        hand.removeCallbacks(watch);
        gray(false);
        front = "";
        target = "";
        try { unregisterReceiver(screen); } catch (Exception ignored) {}
        return super.onUnbind(intent);
    }

    /**
     * Is the service actually switched on? Asked from the plugin, so the app can
     * tell a person that blocking is configured but doing nothing - which is
     * otherwise indistinguishable from blocking that is simply not blocking.
     */
    static boolean running(Context c) {
        try {
            String on = Settings.Secure.getString(c.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (TextUtils.isEmpty(on)) return false;
            String want = c.getPackageName() + "/" + BlockService.class.getName();
            String shortWant = c.getPackageName() + "/." + BlockService.class.getSimpleName();
            for (String part : on.split(":")) {
                if (want.equalsIgnoreCase(part) || shortWant.equalsIgnoreCase(part)) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    /** Can grayscale be switched on at all? WRITE_SECURE_SETTINGS is granted over adb or not at all. */
    static boolean canGray(Context c) {
        // checkCallingOrSelfPermission rather than checkSelfPermission, which is API 23
        return c.checkCallingOrSelfPermission("android.permission.WRITE_SECURE_SETTINGS")
                == PackageManager.PERMISSION_GRANTED;
    }
}
