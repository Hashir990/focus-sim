package app.focussimulator.guard;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

/**
 * Everything the halves of this plugin need to agree about, in one
 * SharedPreferences file. The decisions made from it are in {@link GuardRules}.
 *
 * <p><b>Why a store rather than fields.</b> Four separate lifetimes touch this
 * and none of them can hold a reference to another: the Capacitor plugin lives
 * in the app's process and dies with it, the accessibility service is started by
 * the system and outlives it, the shield is its own activity in its own task,
 * and the notification's buttons arrive at a receiver that may well be the first
 * thing to run after the app was killed. Preferences are the one thing all four
 * can read.
 *
 * <p><b>Values are stored as JSON strings on purpose.</b> The config crosses to
 * JavaScript unchanged, so there is one shape rather than a shape here, a
 * flattening on the way out and a rebuilding on the way in, and a key added on
 * the web side survives a round trip with no edit in this file.
 */
final class GuardStore {
    private GuardStore() {}

    static final String FILE = "focus_guard";

    private static final String K_CONFIG = "config";
    private static final String K_TIMER = "timer";
    private static final String K_ALLOW = "allow";
    private static final String K_GRANTED = "granted";
    private static final String K_LAST = "last";
    private static final String K_USAGE = "usage";
    private static final String K_TASKS = "tasks";
    private static final String K_CMD = "cmd";
    private static final String K_NOTICE = "notice_up";
    private static final String K_CMD_AT = "cmd_at";
    private static final String K_DAY = "day";
    private static final String K_WALL = "day_wall";
    private static final String K_REAL = "day_real";
    private static final String K_BOOT = "day_boot";
    private static final String K_GRAY = "gray_ours";

    /** Days of history kept: a month of weeks, and a streak long enough to be worth keeping. */
    static final int HISTORY_DAYS = 35;

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    private static JSONObject read(Context c, String key) {
        try {
            String s = prefs(c).getString(key, null);
            if (s != null) return new JSONObject(s);
        } catch (Exception ignored) {}
        return new JSONObject();
    }

    private static void write(Context c, String key, JSONObject v) {
        prefs(c).edit().putString(key, v == null ? "{}" : v.toString()).apply();
    }

    /* ---------------- config ----------------
       on       is blocking switched on at all
       rules    [{id, name, apps, sites, when, days, from, to, pause, step, prompt,
                  task, open, opens, minutes, after, cooldown, odds, quick, hard, off}]
       lock     {on, delay}  - while on, a change waits `delay` minutes
       pending  {at, cfg}    - a change waiting out the lock
       gray     grayscale while something blocked is in front
       excl     packages left out of the screen-time total

       The web app writes the canonical shape (50-guard.js, guardClean); this side
       only fills in what a decision would otherwise have to guess at.          */
    static JSONObject config(Context c) {
        JSONObject o = read(c, K_CONFIG);
        /* A change that has waited out the lock is applied the first time
           anything looks — the service, the shield or the page, whichever is
           first — so nothing has to be running at the moment it comes due. */
        JSONObject p = GuardRules.promote(o, System.currentTimeMillis());
        if (p != o) {
            write(c, K_CONFIG, p);
            o = p;
        }
        try {
            if (!o.has("on")) o.put("on", false);
            if (!o.has("rules")) o.put("rules", new JSONArray());
        } catch (Exception ignored) {}
        return o;
    }

    /** Store what the page sent, as far as the lock allows. See {@link GuardRules#accept}. */
    static JSONObject setConfig(Context c, JSONObject incoming) {
        JSONObject stored = config(c);
        JSONObject kept = GuardRules.accept(stored, incoming, System.currentTimeMillis());
        write(c, K_CONFIG, kept);
        return kept;
    }

    /* ---------------- the timer, mirrored ----------------
       The web app owns the clock. This is a copy of it, pushed on every change,
       and it exists because the two things that have to know about the clock
       while the app is frozen - the notification and the shield - cannot ask it.

       "live" is a block exists; "running" is and it is counting. A paused block
       is live and not running, which is exactly the state the ongoing
       notification has to be able to draw.                                     */
    static JSONObject timer(Context c) {
        JSONObject o = read(c, K_TIMER);
        try {
            if (!o.has("live")) o.put("live", false);
            if (!o.has("running")) o.put("running", false);
            if (!o.has("mode")) o.put("mode", "focus");
            if (!o.has("endAt")) o.put("endAt", 0L);
            if (!o.has("remainingMs")) o.put("remainingMs", 0L);
        } catch (Exception ignored) {}
        return o;
    }

    static void setTimer(Context c, JSONObject v) {
        write(c, K_TIMER, v);
    }

    /* Is the ongoing notification currently meant to be on screen? Stored
       rather than inferred, because "the app is in the background" is not a
       question anything here can ask reliably - and the one place that knows
       for certain is the page, at the moment it is hidden. */
    static boolean noticeUp(Context c) {
        return prefs(c).getBoolean(K_NOTICE, false);
    }

    static void setNoticeUp(Context c, boolean v) {
        prefs(c).edit().putBoolean(K_NOTICE, v).apply();
    }

    /* ---------------- the day ---------------- */

    private static String format(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(ms));
    }

    private static int bootCount(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return -1;
        try {
            return Settings.Global.getInt(c.getContentResolver(), Settings.Global.BOOT_COUNT);
        } catch (Exception e) {
            return -1;
        }
    }

    /**
     * The day the counts are filed under. Usually the calendar date; while the
     * lock is on, not a date the phone's clock was moved forward to reach — see
     * {@link GuardRules#acceptDay}.
     *
     * <p><b>The anchors only move when the day is believed.</b> Moving them on a
     * refusal would mean the very next look measures from the tampered clock and
     * believes it. Held, the gap stays as wide as the jump for as long as the
     * clock is wrong, and closes the moment it is put right.
     */
    static String day(Context c) {
        SharedPreferences p = prefs(c);
        long wall = System.currentTimeMillis();
        long real = SystemClock.elapsedRealtime();
        String wallDay = format(wall);
        String lastDay = p.getString(K_DAY, "");
        int boot = bootCount(c);
        boolean sameBoot = boot >= 0 && boot == p.getInt(K_BOOT, -2);
        long wallMoved = wall - p.getLong(K_WALL, wall);
        long realMoved = real - p.getLong(K_REAL, real);
        boolean locked = GuardRules.locked(read(c, K_CONFIG));
        if (GuardRules.acceptDay(lastDay, wallDay, wallMoved, realMoved, sameBoot, locked)) {
            p.edit().putString(K_DAY, wallDay).putLong(K_WALL, wall).putLong(K_REAL, real)
                    .putInt(K_BOOT, boot).apply();
            return wallDay;
        }
        return lastDay;
    }

    /* ---------------- what happened, day by day ----------------
       date → target → {secs, shown, through, closed, quick}. A target is a
       package or site:entry. Seconds are kept for every app that is in front, so
       the stats can show the whole of screen time and not only the part that was
       blocked; the four counts only exist for things a rule covers.           */
    static JSONObject usage(Context c) {
        return read(c, K_USAGE);
    }

    static JSONObject today(Context c) {
        JSONObject d = usage(c).optJSONObject(day(c));
        return d == null ? new JSONObject() : d;
    }

    static void add(Context c, String target, String field, int n) {
        if (target == null || target.isEmpty() || n == 0) return;
        try {
            String d = day(c);
            JSONObject all = usage(c);
            JSONObject t = all.optJSONObject(d);
            if (t == null) t = new JSONObject();
            JSONObject one = t.optJSONObject(target);
            if (one == null) one = new JSONObject();
            one.put(field, one.optInt(field, 0) + n);
            t.put(target, one);
            all.put(d, t);
            if (all.length() > HISTORY_DAYS) trim(all);
            write(c, K_USAGE, all);
        } catch (Exception ignored) {}
    }

    private static void trim(JSONObject all) {
        List<String> days = new ArrayList<>();
        for (Iterator<String> it = all.keys(); it.hasNext(); ) days.add(it.next());
        Collections.sort(days);
        for (int i = 0; i < days.size() - HISTORY_DAYS; i++) all.remove(days.get(i));
    }

    /* ---------------- allowances ----------------
       An allowance is an instant, not a countdown, so nothing has to be running
       for it to expire: a phone switched off for an hour comes back with it
       already over, which is the honest answer.                               */
    static JSONObject allowances(Context c) {
        return read(c, K_ALLOW);
    }

    static JSONObject last(Context c) {
        return read(c, K_LAST);
    }

    /** Minutes the most recent allowance for this target was for, for "your 5 minutes are up". */
    static int granted(Context c, String target) {
        return read(c, K_GRANTED).optInt(target, 0);
    }

    /** Let somebody through. {@code quick} is a quick look: counted separately, not as an open. */
    static void grant(Context c, GuardRules.Match m, int minutes, boolean quick) {
        if (m == null) return;
        long until = System.currentTimeMillis() + Math.max(1, minutes) * 60_000L;
        try {
            JSONObject a = allowances(c);
            a.put(m.target, until);
            write(c, K_ALLOW, a);
            JSONObject g = read(c, K_GRANTED);
            g.put(m.target, Math.max(1, minutes));
            write(c, K_GRANTED, g);
            JSONObject l = last(c);
            l.put(m.rule.optString("id", ""), until);
            write(c, K_LAST, l);
        } catch (Exception ignored) {}
        add(c, m.target, quick ? "quick" : "through", 1);
    }

    /** The odds said no: the way stays shut for a minute. */
    static void refuse(Context c, GuardRules.Match m) {
        if (m == null) return;
        try {
            JSONObject l = last(c);
            l.put(m.rule.optString("id", "") + "#no",
                    System.currentTimeMillis() + GuardRules.ODDS_WAIT_MS);
            write(c, K_LAST, l);
        } catch (Exception ignored) {}
    }

    /** The next moment an allowance runs out, or 0 if none is outstanding. */
    static long nextExpiry(Context c) {
        JSONObject o = allowances(c);
        long now = System.currentTimeMillis(), best = 0;
        for (Iterator<String> it = o.keys(); it.hasNext(); ) {
            long v = o.optLong(it.next(), 0);
            if (v > now && (best == 0 || v < best)) best = v;
        }
        return best;
    }

    /** Everything a decision needs, read once, at this moment. */
    static GuardRules.Verdict verdict(Context c, GuardRules.Match m) {
        Calendar cal = Calendar.getInstance();
        int dow = cal.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY;
        int minute = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE);
        Calendar next = (Calendar) cal.clone();
        next.add(Calendar.DAY_OF_MONTH, 1);
        next.set(Calendar.HOUR_OF_DAY, 0);
        next.set(Calendar.MINUTE, 0);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        return GuardRules.decide(config(c), m, timer(c), today(c), allowances(c), last(c),
                System.currentTimeMillis(), dow, minute, next.getTimeInMillis());
    }

    /* ---------------- the task list, mirrored ----------------
       The shield offers your own open tasks as something to do instead, and the
       shield cannot ask the web app for them - so, like the clock, they are
       pushed down whenever they change.                                        */
    static void setTasks(Context c, JSONArray tasks) {
        prefs(c).edit().putString(K_TASKS, tasks == null ? "[]" : tasks.toString()).apply();
    }

    static JSONArray tasks(Context c) {
        try {
            return new JSONArray(prefs(c).getString(K_TASKS, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /* ---------------- grayscale ----------------
       Whether the colour filter that is on is ours. A person who uses grayscale
       themselves must not have it switched off by a blocker that happened to be
       standing near it.                                                        */
    static boolean grayOurs(Context c) {
        return prefs(c).getBoolean(K_GRAY, false);
    }

    static void setGrayOurs(Context c, boolean v) {
        prefs(c).edit().putBoolean(K_GRAY, v).apply();
    }

    /* ---------------- a button pressed while nobody was home ----------------
       A notification action can arrive when the app's process is gone. The
       receiver applies it to the mirror above, so the notification is right at
       once, and leaves it here for the web app to apply to the real clock
       whenever it next runs. Timestamped, because the app has to be able to tell
       a command it has already applied from a new one.                         */
    static void pushCommand(Context c, String cmd, long at) {
        prefs(c).edit().putString(K_CMD, cmd).putLong(K_CMD_AT, at).apply();
    }

    static JSONObject takeCommand(Context c) {
        JSONObject o = new JSONObject();
        try {
            String cmd = prefs(c).getString(K_CMD, "");
            long at = prefs(c).getLong(K_CMD_AT, 0);
            o.put("cmd", cmd == null ? "" : cmd);
            o.put("at", at);
            if (cmd != null && !cmd.isEmpty()) {
                prefs(c).edit().remove(K_CMD).remove(K_CMD_AT).apply();
            }
        } catch (Exception ignored) {}
        return o;
    }
}
