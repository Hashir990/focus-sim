package app.focussimulator.guard;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import org.json.JSONObject;
import org.junit.Test;

/** What the shield says. */
public class GuardWordsTest {

    private static final long NOW = 1_800_000_000_000L;

    private static GuardRules.Verdict verdict(String rule) throws Exception {
        GuardRules.Verdict v = new GuardRules.Verdict();
        v.rule = new JSONObject(rule);
        return v;
    }

    @Test
    public void todaySaysOnlyWhatThereIsToSay() throws Exception {
        GuardRules.Verdict v = verdict("{}");
        assertEquals("", GuardWords.today(v));
        v.opens = 1;
        assertEquals("Today: opened 1 time", GuardWords.today(v));
        v.opens = 2; v.opensMax = 5; v.secs = 12 * 60 + 40; v.secsMax = 30 * 60; v.closed = 3;
        assertEquals("Today: opened 2 of 5 times · 12 of 30 min · left it 3 times", GuardWords.today(v));
    }

    @Test
    public void eachReasonForNoWayThroughSaysWhenItLifts() throws Exception {
        GuardRules.Verdict v = verdict("{\"when\":\"schedule\",\"to\":\"17:00\"}");
        v.why = "hard";
        assertEquals("Blocked until 17:00.", GuardWords.blocked(v, NOW));
        v.rule = new JSONObject("{\"when\":\"focus\"}");
        assertEquals("Blocked until your focus block ends.", GuardWords.blocked(v, NOW));
        v.why = "minutes"; v.secsMax = 1800;
        assertEquals("You have had your 30 minutes for today.", GuardWords.blocked(v, NOW));
        v.why = "opens"; v.opensMax = 1;
        assertEquals("That was the last of your 1 open today.", GuardWords.blocked(v, NOW));
        v.why = "cooldown"; v.until = NOW + 6 * 60_000L + 1;
        assertEquals("Next open in 7 min.", GuardWords.blocked(v, NOW));
    }

    @Test
    public void theChoicesAreSortedAndNeverOfferMoreThanTheDayHasLeft() throws Exception {
        GuardRules.Verdict v = verdict("{\"open\":[15,1,5,5],\"after\":\"block\"}");
        assertArrayEquals(new int[]{1, 5, 15}, GuardWords.choices(v));

        v.secsMax = 1800; v.secs = 1560;               // four minutes left
        assertArrayEquals(new int[]{1}, GuardWords.choices(v));

        GuardRules.Verdict w = verdict("{\"open\":[5,15],\"after\":\"block\"}");
        w.secsMax = 1800; w.secs = 1560;
        assertArrayEquals("nothing fits, so what is left is offered", new int[]{4}, GuardWords.choices(w));

        GuardRules.Verdict p = verdict("{\"open\":[5,15],\"after\":\"pause\"}");
        p.secsMax = 1800; p.secs = 1560;
        assertArrayEquals("a limit that only pauses does not trim", new int[]{5, 15}, GuardWords.choices(p));

        assertArrayEquals(new int[]{5}, GuardWords.choices(verdict("{}")));
    }

    @Test
    public void theContextLineReadsTheClockOrTheSchedule() throws Exception {
        JSONObject timer = new JSONObject("{\"live\":true,\"running\":true,\"mode\":\"focus\"}");
        timer.put("endAt", NOW + 12 * 60_000L);
        assertEquals("You are in a focus block. 12 min to go.",
                GuardWords.context(new JSONObject("{\"when\":\"focus\"}"), timer, NOW));
        assertEquals("On until 17:00.",
                GuardWords.context(new JSONObject("{\"when\":\"schedule\",\"to\":\"17:00\"}"), timer, NOW));
        assertEquals("", GuardWords.context(new JSONObject("{\"when\":\"always\"}"), timer, NOW));
    }
}
