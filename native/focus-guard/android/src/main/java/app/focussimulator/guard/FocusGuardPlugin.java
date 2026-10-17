package app.focussimulator.guard;

import android.Manifest;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The bridge. Everything the web app can ask for, and nothing it can do without.
 *
 * <p><b>Every method here is safe to call on a device that has granted nothing.</b>
 * The app is offline-first and permission-optional by habit - the update check
 * and the account both work this way - and blocking is no different: with no
 * accessibility service the config is still stored and still shown, it simply
 * does nothing until the switch is thrown. {@code status()} is what the UI reads
 * to say so out loud, rather than looking like it is working when it is not.
 */
@CapacitorPlugin(
        name = "FocusGuard",
        permissions = {
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        }
)
public class FocusGuardPlugin extends Plugin {

    /**
     * The live instance, or null when the app's process is gone.
     *
     * <p>Static because {@link NoticeReceiver} has no way to reach a plugin: it
     * is started by the system for one delivery and knows nothing about
     * Capacitor. When the app happens to be alive this lets a notification
     * button reach the real clock immediately instead of waiting to be picked up
     * on the next resume. When it is not, the write to the store is the whole
     * mechanism and this is simply skipped.
     */
    private static FocusGuardPlugin live;

    @Override
    public void load() {
        live = this;
        TimerNotice.channels(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (live == this) live = null;
        super.handleOnDestroy();
    }

    /** Called from the receiver. A no-op when nothing is listening. */
    static void emit(String cmd, long at) {
        FocusGuardPlugin p = live;
        if (p == null) return;
        try {
            JSObject o = new JSObject();
            o.put("cmd", cmd);
            o.put("at", at);
            p.notifyListeners("guardCommand", o);
        } catch (Exception ignored) {}
    }

    /* ---------------- what is switched on ---------------- */

    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        JSObject o = new JSObject();
        o.put("platform", "android");
        o.put("notifications", notificationsOn(c));
        o.put("overlay", overlayOn(c));
        o.put("accessibility", BlockService.running(c));
        o.put("admin", adminOn(c));
        o.put("gray", BlockService.canGray(c));
        o.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(o);
    }

    private boolean notificationsOn(Context c) {
        try {
            return androidx.core.app.NotificationManagerCompat.from(c).areNotificationsEnabled();
        } catch (Exception e) {
            return false;
        }
    }

    private boolean adminOn(Context c) {
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE);
            return dpm != null && dpm.isAdminActive(GuardAdmin.component(c));
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Ask to become a device admin. Android shows its own screen for it, with the
     * description from strings.xml, and nothing can be granted without it.
     */
    @PluginMethod
    public void requestAdmin(PluginCall call) {
        try {
            Intent i = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                    .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, GuardAdmin.component(getContext()))
                    .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                            "While blocking is locked, this stops it being uninstalled. It asks for nothing else.");
            /* From the activity, never as a new task: DeviceAdminAdd finishes
               itself at once when it is started with FLAG_ACTIVITY_NEW_TASK. */
            if (getActivity() == null) {
                call.reject("No activity");
                return;
            }
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not ask");
        }
    }

    /**
     * Stop being a device admin. Called by the page once the lock has actually
     * come off — so turning the lock off does not leave behind a device admin
     * nobody asked to keep.
     */
    @PluginMethod
    public void releaseAdmin(PluginCall call) {
        try {
            if (GuardRules.locked(GuardStore.config(getContext()))) {
                call.reject("Still locked");
                return;
            }
            DevicePolicyManager dpm = (DevicePolicyManager) getContext().getSystemService(Context.DEVICE_POLICY_SERVICE);
            if (dpm != null && adminOn(getContext())) dpm.removeActiveAdmin(GuardAdmin.component(getContext()));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not release");
        }
    }

    private boolean overlayOn(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        try { return Settings.canDrawOverlays(c); } catch (Exception e) { return false; }
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            /* Before 13 there is no runtime permission - notifications are on
               unless they were switched off in Settings, which is not something
               an app may ask about. Answering with the real state is more useful
               than answering "granted" on principle. */
            JSObject o = new JSObject();
            o.put("granted", notificationsOn(getContext()));
            call.resolve(o);
            return;
        }
        requestPermissionForAlias("notifications", call, "afterNotifications");
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        JSObject o = new JSObject();
        o.put("granted", notificationsOn(getContext()));
        call.resolve(o);
    }

    /**
     * Open the settings screen for one of the two things that cannot be granted
     * by a prompt. Deep-linked, because "Settings, then Accessibility, then
     * Installed apps, then focUS simulator" is four screens people give up on.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String which = call.getString("which", "");
        Context c = getContext();
        Intent i;
        if ("overlay".equals(which)) {
            i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + c.getPackageName()));
        } else if ("accessibility".equals(which)) {
            i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + c.getPackageName()));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { c.startActivity(i); call.resolve(); }
        catch (Exception e) { call.reject("Could not open settings"); }
    }

    /* ---------------- the app list ---------------- */

    /**
     * Every app with a launcher entry, with its name and its icon.
     *
     * <p>The icons are sent as base64 PNGs at 48dp. It is a few hundred kilobytes
     * once, on a screen that is explicitly a picker, and the alternative - a list
     * of package names - is not a thing anybody can use: nobody knows which of
     * the four Google entries on their phone is the one they open at midnight.
     * Ours is left out, because a blocker that can block the blocker is a way to
     * lock yourself out of your own timer.
     */
    @PluginMethod
    public void listApps(PluginCall call) {
        Context c = getContext();
        PackageManager pm = c.getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN, null).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> found = pm.queryIntentActivities(main, 0);
        List<JSObject> out = new ArrayList<>();
        List<String> seen = new ArrayList<>();
        for (ResolveInfo r : found) {
            try {
                String pkg = r.activityInfo.packageName;
                if (pkg == null || pkg.equals(c.getPackageName())) continue;
                if (seen.contains(pkg)) continue;
                seen.add(pkg);
                ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                JSObject o = new JSObject();
                o.put("id", pkg);
                o.put("name", String.valueOf(pm.getApplicationLabel(ai)));
                o.put("system", (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
                o.put("icon", png(pm.getApplicationIcon(ai)));
                out.add(o);
            } catch (Exception ignored) {}
        }
        Collections.sort(out, (a, b) ->
                a.optString("name", "").compareToIgnoreCase(b.optString("name", "")));
        JSArray arr = new JSArray();
        for (JSObject o : out) arr.put(o);
        JSObject res = new JSObject();
        res.put("apps", arr);
        call.resolve(res);
    }

    private String png(Drawable d) {
        if (d == null) return "";
        try {
            int size = (int) (getContext().getResources().getDisplayMetrics().density * 48);
            if (size < 48) size = 48;
            Bitmap bm;
            if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) {
                bm = Bitmap.createScaledBitmap(((BitmapDrawable) d).getBitmap(), size, size, true);
            } else {
                bm = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
                Canvas cv = new Canvas(bm);
                d.setBounds(0, 0, size, size);
                d.draw(cv);
            }
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            bm.compress(Bitmap.CompressFormat.PNG, 100, bos);
            return "data:image/png;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    /* ---------------- config and what it did ---------------- */

    /* One helper, because `JSObject.fromJSONObject` is checked and every
       one of these is handing back an object this file built a moment ago. A
       throw here would be a bug in our own JSON, and the honest thing to give
       the web app then is an empty object rather than a rejected promise it has
       no way to act on. */
    private void resolveJson(PluginCall call, org.json.JSONObject o) {
        try {
            call.resolve(JSObject.fromJSONObject(o));
        } catch (Exception e) {
            call.resolve(new JSObject());
        }
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        resolveJson(call, GuardStore.config(getContext()));
    }

    /**
     * The whole config, as the page holds it. Stored as sent, apart from what the
     * lock refuses (GuardRules.accept) — and what comes back is what was kept, so
     * the page can tell when a change was held rather than applied.
     */
    @PluginMethod
    public void setConfig(PluginCall call) {
        try {
            JSONObject incoming = new JSONObject(call.getData().toString());
            resolveJson(call, GuardStore.setConfig(getContext(), incoming));
        } catch (Exception e) {
            call.reject("Bad config");
        }
    }

    /** Every day of counts kept, and which day this side counts as today. */
    @PluginMethod
    public void getStats(PluginCall call) {
        try {
            JSONObject o = new JSONObject();
            o.put("usage", GuardStore.usage(getContext()));
            o.put("day", GuardStore.day(getContext()));
            resolveJson(call, o);
        } catch (Exception e) {
            call.resolve(new JSObject());
        }
    }

    /** The open tasks, for the shield to offer as something to do instead. */
    @PluginMethod
    public void setTasks(PluginCall call) {
        try {
            JSArray a = call.getArray("tasks", new JSArray());
            GuardStore.setTasks(getContext(), new JSONArray(a.toString()));
            call.resolve();
        } catch (Exception e) {
            call.reject("Bad tasks");
        }
    }

    /* ---------------- the timer ---------------- */

    /**
     * The web app pushing its clock down. Called on every state change, and it
     * is deliberately a whole state rather than start/stop events: an event can
     * be missed by a process that was not running, a state cannot.
     */
    @PluginMethod
    public void setTimer(PluginCall call) {
        try {
            JSONObject t = new JSONObject();
            t.put("live", call.getBoolean("live", false));
            t.put("running", call.getBoolean("running", false));
            t.put("mode", call.getString("mode", "focus"));
            /* **Instants cross as strings.** An epoch in milliseconds is about
               1.7e12, which does not fit an int, and what a JavaScript number
               becomes on this side depends on the bridge rather than on us.
               A string parsed here is the one shape that cannot be rounded. */
            t.put("endAt", asLong(call.getString("endAt", "0")));
            t.put("remainingMs", asLong(call.getString("remainingMs", "0")));
            GuardStore.setTimer(getContext(), t);
            /* Re-arm the alarm, and redraw the ongoing notice only if it is
               already up. Whether it should be up at all is the web app's
               decision and it makes it in showNotice/hideNotice - deciding it
               here as well is two answers, and the loser is whichever call
               happens to land second as the app goes into the background. */
            TimerNotice.sync(getContext(), GuardStore.noticeUp(getContext()));
            call.resolve();
        } catch (Exception e) {
            call.reject("Bad timer");
        }
    }

    private long asLong(String s) {
        try { return Long.parseLong(s.trim()); } catch (Exception e) { return 0L; }
    }

    /**
     * Put the app in the background, as Home would.
     *
     * <p>Called by the page when Back has been pressed with nothing left to
     * close. <b>Not finish().</b> A finished activity is destroyed, and the
     * next launch is a cold start: the WebView reloads, and a block that was
     * running is a block that was running — the clock does not survive a
     * reload. Backgrounding keeps the process and the page exactly as they
     * were, which is what pressing Back on any other app does.
     */
    @PluginMethod
    public void leave(PluginCall call) {
        try {
            getActivity().moveTaskToBack(true);
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void showNotice(PluginCall call) {
        GuardStore.setNoticeUp(getContext(), true);
        TimerNotice.sync(getContext(), true);
        call.resolve();
    }

    @PluginMethod
    public void hideNotice(PluginCall call) {
        GuardStore.setNoticeUp(getContext(), false);
        TimerNotice.hide(getContext());
        call.resolve();
    }

    /**
     * Anything a notification button did while the app was away, and the clock
     * as this side now sees it.
     *
     * <p><b>The mirror comes back with the command, and it has to.</b> Pausing
     * from the notification and coming back an hour later is the normal case,
     * not the edge one - so "resume" alone is not enough information: the block
     * was continued at the moment the button was pressed and it has been running
     * ever since. The web app needs the end time this side settled on, not one
     * worked out from when it happened to be looked at again.
     */
    @PluginMethod
    public void takeCommand(PluginCall call) {
        org.json.JSONObject o = GuardStore.takeCommand(getContext());
        try { o.put("timer", GuardStore.timer(getContext())); } catch (Exception ignored) {}
        resolveJson(call, o);
    }
}
