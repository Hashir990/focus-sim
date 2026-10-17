package app.focussimulator.guard;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Random;

/**
 * The screen that stands in front of a blocked app or site.
 *
 * <p>The shape is ScreenZen's, and each part is there for a reason, because a
 * blocker that simply refuses is a blocker people uninstall:
 *
 * <ul>
 *   <li><b>A pause you sit through</b>, longer each time today. Opening Instagram
 *       is a reflex and reflexes are fast; seconds in which nothing can be pressed
 *       are the only thing that reliably interrupts one.</li>
 *   <li><b>The question you set yourself</b>, and what you were in the middle of,
 *       and what today has looked like — the facts that change the answer.</li>
 *   <li><b>Optionally, a small task</b> — say why, or do a sum — so going through
 *       takes a decision rather than a thumb.</li>
 *   <li><b>A choice of how long</b>, because "five minutes" chosen is an
 *       allowance and "open" is a door. Every choice is counted.</li>
 *   <li><b>Something else to do</b>: your own open tasks, one tap from the app
 *       they are in.</li>
 * </ul>
 *
 * <p><b>Close means Home, not finish.</b> Finishing would return to whatever is
 * underneath, which is the app that was just opened.
 */
public class ShieldActivity extends Activity {

    private final Handler hand = new Handler(Looper.getMainLooper());
    private final Random rnd = new Random();

    private GuardRules.Match match;
    private GuardRules.Verdict verdict;
    private long startedAt;
    private int pauseSecs;
    private boolean decided = false;
    private boolean gateOk = true;

    private RingView ring;
    private TextView countText;
    private View choices;
    private LinearLayout opens;
    private Button quick;
    private TextView openLabel;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            long gone = SystemClock.elapsedRealtime() - startedAt;
            long total = pauseSecs * 1000L;
            if (gone >= total) { ready(); return; }
            ring.setAmount(1f - (float) gone / (float) total);
            countText.setText(String.valueOf((int) Math.ceil((total - gone) / 1000f)));
            hand.postDelayed(this, 100);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.guard_shield);

        ring = findViewById(R.id.guard_ring);
        countText = findViewById(R.id.guard_count);
        choices = findViewById(R.id.guard_choices);
        opens = findViewById(R.id.guard_opens);
        quick = findViewById(R.id.guard_quick);
        openLabel = findViewById(R.id.guard_open_label);
        findViewById(R.id.guard_close).setOnClickListener(v -> close());

        Intent in = getIntent();
        String pkg = extra(in, "pkg");
        String host = extra(in, "host");
        String lock = extra(in, "lock");

        if (!lock.isEmpty()) {
            locked(lock);
            return;
        }

        JSONObject cfg = GuardStore.config(this);
        match = host.isEmpty() ? GuardRules.matchApp(cfg, pkg) : GuardRules.matchSite(cfg, host);
        verdict = match == null ? null : GuardStore.verdict(this, match);
        /* Nothing to stand in front of any more — an allowance granted from a
           second shield, a rule edited, a block ended while this was starting. */
        if (verdict == null || !verdict.shield) {
            decided = true;
            finish();
            overridePendingTransition(0, 0);
            return;
        }
        GuardStore.add(this, match.target, "shown", 1);

        ((TextView) findViewById(R.id.guard_title)).setText(host.isEmpty() ? labelOf(pkg) : host);
        Drawable d = iconOf(pkg);
        if (d != null) ((ImageView) findViewById(R.id.guard_icon)).setImageDrawable(d);

        String prompt = verdict.rule.optString("prompt", "").trim();
        if (!prompt.isEmpty()) ((TextView) findViewById(R.id.guard_prompt)).setText(prompt);

        long now = System.currentTimeMillis();
        String note = in != null && in.getBooleanExtra("up", false)
                ? "Your " + GuardWords.plural(Math.max(1, GuardStore.granted(this, match.target)), "minute is", "minutes are") + " up."
                : GuardWords.context(verdict.rule, GuardStore.timer(this), now);
        text(R.id.guard_note, note);
        text(R.id.guard_today, GuardWords.today(verdict));

        /* No way through means nothing to wait for: the reason is shown at once
           rather than after a countdown that ends in a closed door. */
        pauseSecs = verdict.way ? verdict.pause : 0;
        startedAt = SystemClock.elapsedRealtime();
        ring.setAmount(pauseSecs > 0 ? 1f : 0f);
        if (pauseSecs > 0) hand.post(tick); else ready();
    }

    /** The pause is over: offer what there is to offer. */
    private void ready() {
        ring.setAmount(0f);
        countText.setText("");
        choices.setVisibility(View.VISIBLE);
        instead();

        if (verdict.way && verdict.odds < 100 && rnd.nextInt(100) >= verdict.odds) {
            /* The roll is made once, when the pause ends, and its answer is kept
               for a minute — or closing and reopening would simply roll again. */
            GuardStore.refuse(this, match);
            verdict.way = false;
            verdict.why = "odds";
        }
        if (!verdict.way) {
            text(R.id.guard_blocked, GuardWords.blocked(verdict, System.currentTimeMillis()));
            openLabel.setVisibility(View.GONE);
            opens.setVisibility(View.GONE);
            return;
        }

        int[] mins = GuardWords.choices(verdict);
        opens.removeAllViews();
        for (int m : mins) {
            Button btn = ghost(m + " min");
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(48), 1f);
            if (opens.getChildCount() > 0) lp.leftMargin = dp(8);
            btn.setLayoutParams(lp);
            btn.setOnClickListener(v -> through(m, false));
            opens.addView(btn);
        }
        if (verdict.quickLeft > 0) {
            quick.setVisibility(View.VISIBLE);
            quick.setText("Just a quick look · " + GuardRules.QUICK_MINUTES + " min ("
                    + verdict.quickLeft + " left today)");
            quick.setOnClickListener(v -> through(GuardRules.QUICK_MINUTES, true));
        }
        gate();
    }

    /* ---------------- the small task ---------------- */

    private void gate() {
        String task = verdict.rule.optString("task", "none");
        if (!"reason".equals(task) && !"sum".equals(task)) return;
        View box = findViewById(R.id.guard_gate);
        TextView ask = findViewById(R.id.guard_gate_ask);
        EditText input = findViewById(R.id.guard_gate_input);
        box.setVisibility(View.VISIBLE);
        final int answer;
        if ("sum".equals(task)) {
            int a = 12 + rnd.nextInt(38), c = 11 + rnd.nextInt(29);
            answer = a + c;
            ask.setText("What is " + a + " + " + c + "?");
            input.setInputType(InputType.TYPE_CLASS_NUMBER);
        } else {
            answer = -1;
            ask.setText("What are you opening it for?");
            input.setHint("A few words");
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        }
        setGate(false);
        input.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
            @Override public void onTextChanged(CharSequence s, int st, int b, int c) {}
            @Override
            public void afterTextChanged(Editable e) {
                String t = e.toString().trim();
                if (answer >= 0) {
                    try { setGate(Integer.parseInt(t) == answer); }
                    catch (NumberFormatException ex) { setGate(false); }
                } else {
                    // ten characters: long enough to have said something
                    setGate(t.length() >= 10);
                }
            }
        });
    }

    /** Dimmed and unpressable until the task is done. Unlike a limit, this is a gate you can open. */
    private void setGate(boolean ok) {
        gateOk = ok;
        for (int i = 0; i < opens.getChildCount(); i++) {
            View v = opens.getChildAt(i);
            v.setEnabled(ok);
            v.setAlpha(ok ? 1f : 0.4f);
        }
        quick.setEnabled(ok);
        quick.setAlpha(ok ? 1f : 0.4f);
    }

    /* ---------------- your tasks, instead ---------------- */

    private void instead() {
        JSONArray tasks = GuardStore.tasks(this);
        LinearLayout box = findViewById(R.id.guard_instead);
        int shown = 0;
        for (int i = 0; i < tasks.length() && shown < 3; i++) {
            JSONObject t = tasks.optJSONObject(i);
            String label = t == null ? "" : t.optString("text", "").trim();
            if (label.isEmpty()) continue;
            Button btn = ghost(label);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, dp(46));
            lp.topMargin = shown == 0 ? 0 : dp(8);
            btn.setLayoutParams(lp);
            btn.setOnClickListener(v -> doInstead());
            box.addView(btn);
            shown++;
        }
        box.setVisibility(shown > 0 ? View.VISIBLE : View.GONE);
    }

    /** Leave it, and go to the app the task is in. Counted as leaving it, because it is. */
    private void doInstead() {
        if (decided) return;
        decided = true;
        if (match != null) GuardStore.add(this, match.target, "closed", 1);
        /* **Left behind so the app knows this is why it woke up.** Coming back
           from the shield is not the same as switching back to the app: you
           pressed a button that said "go to Focus", so Focus is what you asked
           for, not whichever screen happened to be open when you left. The web
           app reads this the same way it reads a notification button. */
        GuardStore.pushCommand(this, "home", System.currentTimeMillis());
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) {
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { startActivity(open); } catch (Exception ignored) {}
        }
        finish();
        overridePendingTransition(0, 0);
    }

    /* ---------------- the ways out ---------------- */

    private void through(int mins, boolean isQuick) {
        if (decided || !gateOk) return;
        decided = true;
        GuardStore.grant(this, match, mins, isQuick);
        /* Finish rather than go home: the app underneath is exactly where this
           choice means to land. */
        finish();
        overridePendingTransition(0, 0);
    }

    private void close() {
        if (decided) return;
        decided = true;
        if (match != null) GuardStore.add(this, match.target, "closed", 1);
        Intent home = new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_HOME)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(home); } catch (Exception ignored) {}
        finish();
        overridePendingTransition(0, 0);
    }

    /** Standing in front of a Settings screen while the lock is on. Close is the only thing on it. */
    private void locked(String kind) {
        ((TextView) findViewById(R.id.guard_title)).setText("Blocking is locked");
        ((TextView) findViewById(R.id.guard_prompt)).setText("uninstall".equals(kind)
                ? "It can't be uninstalled while it is locked."
                : "This can't be changed while it is locked.");
        int delay = GuardRules.lockDelay(GuardStore.config(this));
        text(R.id.guard_note, "Unlock it in focUS simulator. It takes "
                + GuardWords.plural(delay, "minute", "minutes") + " to come through.");
        Drawable d = iconOf(getPackageName());
        if (d != null) ((ImageView) findViewById(R.id.guard_icon)).setImageDrawable(d);
        ring.setAmount(0f);
        choices.setVisibility(View.VISIBLE);
        openLabel.setVisibility(View.GONE);
        opens.setVisibility(View.GONE);
    }

    /**
     * Back is Close, and is the only thing it can be. Letting it fall through
     * would drop the shield straight back onto the app it is covering.
     */
    @Override
    public void onBackPressed() {
        close();
    }

    @Override
    protected void onDestroy() {
        hand.removeCallbacks(tick);
        super.onDestroy();
    }

    /* ---------------- small things ---------------- */

    private static String extra(Intent in, String k) {
        String v = in == null ? null : in.getStringExtra(k);
        return v == null ? "" : v;
    }

    private void text(int id, String s) {
        TextView t = findViewById(id);
        t.setText(s == null ? "" : s);
        t.setVisibility(s == null || s.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private Button ghost(String label) {
        Button b = new Button(this);
        b.setBackgroundResource(R.drawable.guard_btn_ghost);
        b.setAllCaps(false);
        b.setText(label);
        b.setTextSize(15);
        b.setTextColor(getResources().getColor(R.color.guard_text));
        b.setSingleLine(true);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private String labelOf(String p) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(p, 0);
            return String.valueOf(pm.getApplicationLabel(ai));
        } catch (Exception e) {
            return p;
        }
    }

    private Drawable iconOf(String p) {
        try {
            return getPackageManager().getApplicationIcon(p);
        } catch (Exception e) {
            return null;
        }
    }
}
