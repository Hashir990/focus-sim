package app.focussimulator.guard;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * What the shield says, worked out without a screen, so it can be tested beside
 * the rules it describes (GuardRulesTest).
 *
 * <p><b>Every line says something only the numbers know.</b> "Blocked" tells you
 * nothing you did not know when you tapped the icon. "That was the last of your
 * 3 opens today" and "Next open in 7 min" are the facts that change the answer.
 */
final class GuardWords {
    private GuardWords() {}

    static String plural(int n, String one, String many) {
        return n + " " + (n == 1 ? one : many);
    }

    private static int minutesUp(long ms) {
        return (int) Math.max(1, Math.ceil(ms / 60_000d));
    }

    /** Today so far, for this rule: opens, minutes, and the times you left it. "" when there is nothing. */
    static String today(GuardRules.Verdict v) {
        List<String> parts = new ArrayList<>();
        if (v.opensMax > 0) parts.add("opened " + v.opens + " of " + plural(v.opensMax, "time", "times"));
        else if (v.opens > 0) parts.add("opened " + plural(v.opens, "time", "times"));
        int mins = v.secs / 60;
        if (v.secsMax > 0) parts.add(mins + " of " + (v.secsMax / 60) + " min");
        else if (mins > 0) parts.add(mins + " min");
        if (v.closed > 0) parts.add("left it " + plural(v.closed, "time", "times"));
        if (parts.isEmpty()) return "";
        String s = "Today: " + String.join(" · ", parts);
        return s;
    }

    /** Why there is no way through. */
    static String blocked(GuardRules.Verdict v, long now) {
        JSONObject r = v.rule;
        switch (v.why) {
            case "hard": {
                String when = r == null ? "" : r.optString("when", "focus");
                if ("schedule".equals(when)) return "Blocked until " + r.optString("to", "") + ".";
                if ("focus".equals(when)) return "Blocked until your focus block ends.";
                if ("session".equals(when)) return "Blocked until this session ends.";
                return "Blocked.";
            }
            case "minutes":
                return "You have had your " + (v.secsMax / 60) + " minutes for today.";
            case "opens":
                return "That was the last of your " + plural(v.opensMax, "open", "opens") + " today.";
            case "cooldown":
                return "Next open in " + minutesUp(v.until - now) + " min.";
            case "odds":
                return "Not this time. Try again in a minute.";
            default:
                return "";
        }
    }

    /** What the clock says, for a rule tied to it; what the schedule says, for one that is not. */
    static String context(JSONObject rule, JSONObject timer, long now) {
        String when = rule == null ? "focus" : rule.optString("when", "focus");
        if ("schedule".equals(when)) return "On until " + rule.optString("to", "") + ".";
        if ("always".equals(when)) return "";
        if (!GuardRules.timerRunning(timer, false)) return "";
        boolean focus = "focus".equals(timer.optString("mode", "focus"));
        long ms = Math.max(0, timer.optLong("endAt", 0) - now);
        int mins = minutesUp(ms);
        if (!focus) return "Your break has " + mins + " min left.";
        return mins <= 1 ? "Your focus block is nearly over." : "You are in a focus block. " + mins + " min to go.";
    }

    /**
     * The minutes offered, smallest first. A rule that stops you at its daily
     * minutes never offers more than is left of them: offering fifteen with four
     * left is offering four and calling it fifteen.
     */
    static int[] choices(GuardRules.Verdict v) {
        List<Integer> out = new ArrayList<>();
        JSONArray a = v.rule == null ? null : v.rule.optJSONArray("open");
        if (a != null) {
            for (int i = 0; i < a.length(); i++) {
                int n = Math.max(1, Math.min(120, a.optInt(i, 5)));
                if (!out.contains(n)) out.add(n);
            }
        }
        if (out.isEmpty()) out.add(5);
        Collections.sort(out);
        boolean capped = v.rule != null && !"pause".equals(v.rule.optString("after", "block"));
        if (capped && v.secsMax > 0) {
            int left = (int) Math.ceil((v.secsMax - v.secs) / 60d);
            List<Integer> fit = new ArrayList<>();
            for (int n : out) if (n <= left) fit.add(n);
            if (fit.isEmpty() && left > 0) fit.add(left);
            out = fit;
        }
        int[] r = new int[out.size()];
        for (int i = 0; i < r.length; i++) r[i] = out.get(i);
        return r;
    }
}
