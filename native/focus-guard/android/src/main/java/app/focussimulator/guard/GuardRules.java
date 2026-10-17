package app.focussimulator.guard;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Every decision the blocker makes, and nothing that talks to Android.
 *
 * <p><b>Why a class with no Context in it.</b> This machine cannot run an
 * emulator and the rules are where a blocker is wrong in ways nobody notices: a
 * schedule that crosses midnight on the wrong day, a limit counted per app when
 * it was set per group, an allowance that outlives the limit it was granted
 * under. Kept free of Android, every one of those is a plain JVM test
 * ({@code GuardRulesTest}) rather than a phone and a stopwatch.
 *
 * <p><b>The shape is ScreenZen's.</b> A rule is a group of apps and sites that
 * share one set of settings — a group of one is per-app settings. It is in force
 * during a focus block, during any session, always, or on a schedule; and while
 * it is, opening anything in it means a pause, maybe a small task, and a choice
 * of how long to go in for. Limits on opens and on minutes are the group's, not
 * each app's, because "half an hour of social media" is one budget however many
 * apps it is spent in.
 */
final class GuardRules {
    private GuardRules() {}

    /** A target is a package name, or one of these followed by what it names. */
    static final String SITE = "site:";

    /** Quick looks allowed per rule per day: one minute each, and not counted as opens. */
    static final int QUICK_PER_DAY = 3;
    static final int QUICK_MINUTES = 1;

    /** How long a failed roll of the unlock odds keeps the way shut. */
    static final long ODDS_WAIT_MS = 60_000L;

    /* ---------------- addresses ---------------- */

    /**
     * The host a browser's address bar is showing, lower-cased and without a
     * leading {@code www.}, or {@code ""} when it is not showing one.
     *
     * <p>Address bars drop the scheme, add a path, and show a half-typed search
     * while you type — so this is forgiving about everything around the host and
     * strict about the host itself: no dot, no host. A search for "youtube" is a
     * search, not a visit.
     */
    static String host(String bar) {
        if (bar == null) return "";
        String s = bar.trim().toLowerCase(Locale.US);
        int scheme = s.indexOf("://");
        if (scheme >= 0) s = s.substring(scheme + 3);
        int cut = s.length();
        for (char ch : new char[]{'/', '?', '#', ' ', ':'}) {
            int i = s.indexOf(ch);
            if (i >= 0 && i < cut) cut = i;
        }
        s = s.substring(0, cut);
        if (s.startsWith("www.")) s = s.substring(4);
        if (s.indexOf('.') <= 0 || s.endsWith(".")) return "";
        return s;
    }

    /** A site entry covers itself and everything under it: youtube.com covers m.youtube.com. */
    static boolean siteMatches(String host, String site) {
        if (host == null || site == null || host.isEmpty() || site.isEmpty()) return false;
        return host.equals(site) || host.endsWith("." + site);
    }

    /* ---------------- which rule ---------------- */

    static final class Match {
        final JSONObject rule;
        /** The key allowances and counts are kept under: the package, or site:entry. */
        final String target;

        Match(JSONObject rule, String target) {
            this.rule = rule;
            this.target = target;
        }
    }

    /** The first rule that names this app. Rules are in the order the person put them. */
    static Match matchApp(JSONObject cfg, String pkg) {
        if (cfg == null || pkg == null || pkg.isEmpty()) return null;
        JSONArray rules = cfg.optJSONArray("rules");
        if (rules == null) return null;
        for (int i = 0; i < rules.length(); i++) {
            JSONObject r = rules.optJSONObject(i);
            if (r == null || r.optBoolean("off", false)) continue;
            JSONArray apps = r.optJSONArray("apps");
            if (apps == null) continue;
            for (int j = 0; j < apps.length(); j++) {
                if (pkg.equals(apps.optString(j, ""))) return new Match(r, pkg);
            }
        }
        return null;
    }

    /**
     * The first rule with a site covering this host, keyed by the entry rather
     * than the host — so m.youtube.com and youtube.com share one allowance and
     * one count, which is what somebody who typed "youtube.com" meant.
     */
    static Match matchSite(JSONObject cfg, String host) {
        if (cfg == null || host == null || host.isEmpty()) return null;
        JSONArray rules = cfg.optJSONArray("rules");
        if (rules == null) return null;
        for (int i = 0; i < rules.length(); i++) {
            JSONObject r = rules.optJSONObject(i);
            if (r == null || r.optBoolean("off", false)) continue;
            JSONArray sites = r.optJSONArray("sites");
            if (sites == null) continue;
            for (int j = 0; j < sites.length(); j++) {
                String s = sites.optString(j, "");
                if (siteMatches(host, s)) return new Match(r, SITE + s);
            }
        }
        return null;
    }

    /** Does any rule block sites at all? The service reads no address bar unless one does. */
    static boolean anySites(JSONObject cfg) {
        JSONArray rules = cfg == null ? null : cfg.optJSONArray("rules");
        if (rules == null) return false;
        for (int i = 0; i < rules.length(); i++) {
            JSONObject r = rules.optJSONObject(i);
            if (r == null || r.optBoolean("off", false)) continue;
            JSONArray s = r.optJSONArray("sites");
            if (s != null && s.length() > 0) return true;
        }
        return false;
    }

    /* ---------------- when ---------------- */

    /** "HH:MM" as minutes past midnight, or -1. */
    static int clock(String hhmm) {
        if (hhmm == null) return -1;
        String[] p = hhmm.trim().split(":");
        if (p.length != 2) return -1;
        try {
            int h = Integer.parseInt(p[0]), m = Integer.parseInt(p[1]);
            if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
            return h * 60 + m;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static boolean onDay(String days, int dow) {
        return days != null && days.indexOf(Character.forDigit(((dow % 7) + 7) % 7, 10)) >= 0;
    }

    /**
     * Is {@code minute} on weekday {@code dow} (0 = Sunday) inside the window?
     *
     * <p>A window that ends earlier than it starts runs overnight, and <b>the
     * hours after midnight belong to the day it started</b>: "weeknights 22:00 to
     * 07:00" is in force at 02:00 on Saturday morning because Friday is a
     * weeknight, and not at 02:00 on Monday because Sunday is not. Equal ends mean
     * all day.
     */
    static boolean inWindow(String days, int from, int to, int dow, int minute) {
        if (from < 0 || to < 0) return false;
        if (from == to) return onDay(days, dow);
        if (from < to) return onDay(days, dow) && minute >= from && minute < to;
        if (minute >= from) return onDay(days, dow);
        if (minute < to) return onDay(days, dow + 6);
        return false;
    }

    /** Is a focus block, or any block, running on the mirrored clock? */
    static boolean timerRunning(JSONObject timer, boolean focusOnly) {
        if (timer == null) return false;
        boolean running = timer.optBoolean("live", false) && timer.optBoolean("running", false);
        if (!focusOnly) return running;
        return running && "focus".equals(timer.optString("mode", "focus"));
    }

    /** Is this rule in force at this moment? */
    /** Not in force at all. */
    static final String OFF = "";
    /** In force, with whatever way through the rule allows. */
    static final String LIMIT = "limit";
    /** In force, and no way through at all. */
    static final String BLOCK = "block";

    /**
     * Which way a rule is in force right now, rather than merely whether.
     *
     * <p>A rule used to have one set of hours and one answer: in force or not,
     * hard or not, the same all day. That cannot say "blocked while I am
     * working, but let me at it over lunch", which is the thing most people
     * actually want and the thing they build by hand out of three rules that
     * then have to be kept in step with each other.
     *
     * <p>So a scheduled rule may carry a list of windows, each with its own
     * days, range and mode, and <b>the last one that matches wins</b>. That
     * ordering is the whole grammar: a Break laid over a Block carves a hole in
     * it, and the hole is written after the thing it is a hole in, the way you
     * would say it out loud. First-match-wins would mean writing the exceptions
     * first and the rule last, which reads backwards and is the sort of thing
     * people get wrong once and never trust again.
     *
     * <p>A window's mode is authoritative while it is the match, so one rule can
     * be hard at some hours and soft at others. The rule's own {@code hard} flag
     * applies only when nothing has overridden it, which keeps every rule
     * written before windows existed behaving exactly as it did.
     */
    static String forceMode(JSONObject rule, JSONObject timer, int dow, int minute) {
        if (rule == null) return OFF;
        String when = rule.optString("when", "focus");
        boolean hard = rule.optBoolean("hard", false);
        String plain = hard ? BLOCK : LIMIT;
        if ("schedule".equals(when)) {
            JSONArray w = rule.optJSONArray("windows");
            if (w != null && w.length() > 0) {
                String mode = OFF;
                for (int i = 0; i < w.length(); i++) {
                    JSONObject x = w.optJSONObject(i);
                    if (x == null) continue;
                    if (!inWindow(x.optString("d", "0123456"),
                            clock(x.optString("f", "09:00")),
                            clock(x.optString("t", "17:00")), dow, minute)) continue;
                    String m = x.optString("m", LIMIT);
                    /* Anything that is not one of the three is a break, because
                       a window nobody can read should not block anything. */
                    mode = BLOCK.equals(m) ? BLOCK : (LIMIT.equals(m) ? LIMIT : OFF);
                }
                return mode;
            }
            /* No windows: the single range every rule had before this. */
            return inWindow(rule.optString("days", "0123456"),
                    clock(rule.optString("from", "09:00")),
                    clock(rule.optString("to", "17:00")), dow, minute) ? plain : OFF;
        }
        if ("always".equals(when)) return plain;
        return timerRunning(timer, !"session".equals(when)) ? plain : OFF;
    }

    /** Whether, for the callers that only need to know that much. */
    static boolean inForce(JSONObject rule, JSONObject timer, int dow, int minute) {
        return !forceMode(rule, timer, dow, minute).isEmpty();
    }

    /* ---------------- counting ---------------- */

    /** A field summed over every app and site in the rule, from one day's counts. */
    static int count(JSONObject rule, JSONObject day, String field) {
        if (rule == null || day == null) return 0;
        int n = 0;
        JSONArray apps = rule.optJSONArray("apps");
        if (apps != null) {
            for (int i = 0; i < apps.length(); i++) {
                JSONObject t = day.optJSONObject(apps.optString(i, ""));
                if (t != null) n += t.optInt(field, 0);
            }
        }
        JSONArray sites = rule.optJSONArray("sites");
        if (sites != null) {
            for (int i = 0; i < sites.length(); i++) {
                JSONObject t = day.optJSONObject(SITE + sites.optString(i, ""));
                if (t != null) n += t.optInt(field, 0);
            }
        }
        return n;
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    /* ---------------- the decision ---------------- */

    static final class Verdict {
        /** Stand in front of it. */
        boolean shield;
        /** Once the pause is over, is there any way through? */
        boolean way = true;
        /** Why not: hard, minutes, opens, cooldown, odds. Empty when there is a way. */
        String why = "";
        /** When the reason lifts, for the ones that lift on a clock; 0 otherwise. */
        long until;
        /** Seconds to sit through before anything can be pressed. */
        int pause;
        int opens, opensMax, secs, secsMax, closed, quickLeft;
        /** Percent chance, rolled when the pause ends, that the way through is offered. */
        int odds = 100;
        JSONObject rule;
        String target = "";
    }

    /**
     * Should the shield stand in front of this, and what may it offer?
     *
     * @param today    one day's counts, target → {secs, through, closed, quick, shown}
     * @param allow    target → the instant its current allowance runs out
     * @param last     rule id → the instant its last allowance ran out, and
     *                 rule id + "#no" → the instant a failed roll of the odds lifts
     * @param tomorrow the instant the next day starts, for limits that reset at midnight
     */
    static Verdict decide(JSONObject cfg, Match m, JSONObject timer, JSONObject today,
                          JSONObject allow, JSONObject last, long now, int dow, int minute,
                          long tomorrow) {
        Verdict v = new Verdict();
        if (cfg == null || m == null || !cfg.optBoolean("on", false)) return v;
        JSONObject r = m.rule;
        v.rule = r;
        v.target = m.target;
        String mode = forceMode(r, timer, dow, minute);
        if (mode.isEmpty()) return v;

        v.opens = count(r, today, "through");
        v.closed = count(r, today, "closed");
        v.opensMax = clamp(r.optInt("opens", 0), 0, 50);
        v.secs = count(r, today, "secs");
        v.secsMax = clamp(r.optInt("minutes", 0), 0, 1440) * 60;
        v.quickLeft = r.optBoolean("quick", false)
                ? Math.max(0, QUICK_PER_DAY - count(r, today, "quick")) : 0;
        v.odds = clamp(r.optInt("odds", 100), 1, 100);

        boolean hardAtLimit = !"pause".equals(r.optString("after", "block"));
        boolean overTime = v.secsMax > 0 && v.secs >= v.secsMax;

        /* **An allowance is honoured until it runs out — unless the daily
           minutes run out first.** Otherwise "open for 15 minutes" at minute 29
           of a 30-minute limit is fourteen minutes past the limit, and a limit
           you can overrun by asking for a long allowance is not a limit. */
        long until = allow == null ? 0 : allow.optLong(m.target, 0);
        if (until > now && !(overTime && hardAtLimit)) return v;

        v.shield = true;
        int base = clamp(r.optInt("pause", 10), 0, 120);
        int step = clamp(r.optInt("step", 0), 0, 60);
        /* The pause grows with every open today, and stops growing at five
           minutes: past that it is not a pause, it is a wall that happens to
           have a timer on it. */
        v.pause = Math.min(300, base + step * v.opens);

        /* The window's mode, not the rule's flag: a rule can be hard at some
           hours and soft at others, and while a window is the match it is the
           one that says which. forceMode has already folded the rule's own flag
           in for every rule that has no windows. */
        if (BLOCK.equals(mode)) {
            v.way = false;
            v.why = "hard";
            return v;
        }
        if (hardAtLimit && overTime) {
            v.way = false;
            v.why = "minutes";
            v.until = tomorrow;
            return v;
        }
        if (hardAtLimit && v.opensMax > 0 && v.opens >= v.opensMax) {
            v.way = false;
            v.why = "opens";
            v.until = tomorrow;
            return v;
        }
        String id = r.optString("id", "");
        int cool = clamp(r.optInt("cooldown", 0), 0, 240);
        long ended = last == null ? 0 : last.optLong(id, 0);
        /* Counted from when the last allowance *ended*, not from when it was
           granted. From the grant, a ten-minute cooldown after a fifteen-minute
           allowance has already passed by the time it could matter. */
        if (cool > 0 && ended > 0 && now < ended + cool * 60_000L) {
            v.way = false;
            v.why = "cooldown";
            v.until = ended + cool * 60_000L;
            return v;
        }
        long refused = last == null ? 0 : last.optLong(id + "#no", 0);
        if (refused > now) {
            v.way = false;
            v.why = "odds";
            v.until = refused;
            return v;
        }
        return v;
    }

    /* ---------------- the lock ---------------- */

    /** Is the lock switched on in this config? */
    static boolean locked(JSONObject cfg) {
        JSONObject lock = cfg == null ? null : cfg.optJSONObject("lock");
        return cfg != null && cfg.optBoolean("on", false) && lock != null && lock.optBoolean("on", false);
    }

    /** Minutes a change waits while locked. */
    static int lockDelay(JSONObject cfg) {
        JSONObject lock = cfg == null ? null : cfg.optJSONObject("lock");
        return lock == null ? 10 : clamp(lock.optInt("delay", 10), 1, 1440);
    }

    /**
     * A change that has waited out the lock, applied. Returns {@code cfg} itself
     * when there is nothing due.
     */
    static JSONObject promote(JSONObject cfg, long now) {
        if (cfg == null) return null;
        JSONObject p = cfg.optJSONObject("pending");
        if (p == null) return cfg;
        long at = p.optLong("at", 0);
        JSONObject next = p.optJSONObject("cfg");
        if (at <= 0 || next == null || at > now) return cfg;
        try {
            JSONObject out = new JSONObject(next.toString());
            out.remove("pending");
            return out;
        } catch (Exception e) {
            return cfg;
        }
    }

    /**
     * What to keep when the web app sends a new config.
     *
     * <p><b>The lock is enforced here, not only on the page.</b> While the stored
     * config is locked, the only thing an incoming one may change is what is
     * waiting: a new pending change that waits out the full delay, or none (a
     * pending change can always be cancelled — cancelling can only keep blocking
     * as strict as it is). Everything else in it is ignored. A page with a bug in
     * it, or a stale page from before the lock, cannot loosen anything by saving.
     */
    static JSONObject accept(JSONObject stored, JSONObject incoming, long now) {
        if (incoming == null) return stored;
        if (stored == null || !locked(stored)) return incoming;
        try {
            JSONObject out = new JSONObject(stored.toString());
            JSONObject p = incoming.optJSONObject("pending");
            if (p == null) {
                out.remove("pending");
                return out;
            }
            long at = p.optLong("at", 0);
            long earliest = now + lockDelay(stored) * 60_000L - 60_000L;
            JSONObject had = stored.optJSONObject("pending");
            /* Re-sending the change that is already waiting keeps its time: a
               page saved twice must not push the wait further out, and must not
               be able to pull it in either. */
            if (had != null && had.optLong("at", 0) > 0 && at == had.optLong("at", 0)) {
                out.put("pending", p);
                return out;
            }
            if (at < earliest || p.optJSONObject("cfg") == null) return out;
            out.put("pending", p);
            return out;
        } catch (Exception e) {
            return stored;
        }
    }

    /* ---------------- the date ---------------- */

    /**
     * Should the daily counts move on to a new day?
     *
     * <p>Limits reset at midnight, so moving the phone's clock forward a day is
     * a fresh set of opens. While locked, a new day is only believed if the wall
     * clock has not run ahead of real elapsed time (which includes sleep and
     * cannot be set) by more than a few minutes since the last look, and a day
     * earlier than the last one is never believed. After a reboot the two clocks
     * cannot be compared, so the wall clock is taken at its word.
     */
    static boolean acceptDay(String lastDay, String wallDay, long wallMoved, long realMoved,
                             boolean sameBoot, boolean locked) {
        if (lastDay == null || lastDay.isEmpty() || lastDay.equals(wallDay)) return true;
        if (!locked || !sameBoot) return true;
        if (wallDay.compareTo(lastDay) < 0) return false;
        return wallMoved <= realMoved + 10 * 60_000L;
    }
}
