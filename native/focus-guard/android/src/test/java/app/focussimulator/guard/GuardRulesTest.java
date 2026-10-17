package app.focussimulator.guard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The blocker's rules, on the JVM. Every case here is one that would otherwise
 * need a phone, a schedule and a clock to find — which this machine cannot run.
 *
 *     android/ gradlew :focus-guard:testDebugUnitTest
 */
public class GuardRulesTest {

    private static final long NOW = 1_800_000_000_000L;
    private static final long TOMORROW = NOW + 6 * 3_600_000L;
    private static final int MON = 1, FRI = 5, SAT = 6, SUN = 0;

    private static JSONObject rule(String json) throws Exception {
        JSONObject r = new JSONObject(json);
        if (!r.has("id")) r.put("id", "r1");
        return r;
    }

    private static JSONObject cfg(JSONObject... rules) throws Exception {
        JSONObject c = new JSONObject();
        c.put("on", true);
        JSONArray a = new JSONArray();
        for (JSONObject r : rules) a.put(r);
        c.put("rules", a);
        return c;
    }

    private static JSONObject focusRunning() throws Exception {
        return new JSONObject("{\"live\":true,\"running\":true,\"mode\":\"focus\"}");
    }

    private static JSONObject day(String json) throws Exception {
        return new JSONObject(json);
    }

    private static GuardRules.Verdict decide(JSONObject c, String pkg, JSONObject today,
                                             JSONObject allow, JSONObject last) throws Exception {
        return GuardRules.decide(c, GuardRules.matchApp(c, pkg), focusRunning(), today,
                allow, last, NOW, MON, 10 * 60, TOMORROW);
    }

    /* ---------------- addresses ---------------- */

    @Test
    public void hostIsReadOutOfWhateverTheAddressBarShows() {
        assertEquals("youtube.com", GuardRules.host("https://www.youtube.com/watch?v=1"));
        assertEquals("m.youtube.com", GuardRules.host("m.youtube.com/feed"));
        assertEquals("reddit.com", GuardRules.host("  WWW.Reddit.COM:443/r/all "));
        assertEquals("", GuardRules.host("youtube"));
        assertEquals("", GuardRules.host("how to cook rice"));
        assertEquals("", GuardRules.host(null));
    }

    @Test
    public void aSiteCoversItsSubdomainsAndNothingThatMerelyEndsTheSame() {
        assertTrue(GuardRules.siteMatches("m.youtube.com", "youtube.com"));
        assertTrue(GuardRules.siteMatches("youtube.com", "youtube.com"));
        assertFalse(GuardRules.siteMatches("notyoutube.com", "youtube.com"));
        assertFalse(GuardRules.siteMatches("", "youtube.com"));
    }

    @Test
    public void aSiteIsCountedUnderTheEntryThePersonTyped() throws Exception {
        JSONObject c = cfg(rule("{\"sites\":[\"youtube.com\"]}"));
        GuardRules.Match m = GuardRules.matchSite(c, "m.youtube.com");
        assertNotNull(m);
        assertEquals("site:youtube.com", m.target);
        assertNull(GuardRules.matchSite(c, "vimeo.com"));
        assertTrue(GuardRules.anySites(c));
    }

    @Test
    public void theFirstRuleThatNamesAnAppWinsAndSwitchedOffRulesDoNot() throws Exception {
        JSONObject off = rule("{\"id\":\"a\",\"off\":true,\"apps\":[\"x.insta\"]}");
        JSONObject first = rule("{\"id\":\"b\",\"apps\":[\"x.insta\"]}");
        JSONObject second = rule("{\"id\":\"c\",\"apps\":[\"x.insta\"]}");
        GuardRules.Match m = GuardRules.matchApp(cfg(off, first, second), "x.insta");
        assertEquals("b", m.rule.optString("id"));
        assertNull(GuardRules.matchApp(cfg(off), "x.insta"));
    }

    /* ---------------- when ---------------- */

    @Test
    public void aDaytimeWindowIsThoseHoursOnThoseDays() {
        int nine = 9 * 60, five = 17 * 60;
        assertTrue(GuardRules.inWindow("12345", nine, five, MON, 10 * 60));
        assertFalse(GuardRules.inWindow("12345", nine, five, MON, 17 * 60));
        assertFalse(GuardRules.inWindow("12345", nine, five, SAT, 10 * 60));
    }

    @Test
    public void theSmallHoursBelongToTheNightThatStartedThem() {
        int ten = 22 * 60, seven = 7 * 60;
        // weeknights: Friday counts, Sunday does not
        assertTrue(GuardRules.inWindow("12345", ten, seven, FRI, 23 * 60));
        assertTrue("2am Saturday is still Friday night",
                GuardRules.inWindow("12345", ten, seven, SAT, 2 * 60));
        assertFalse("2am Monday is Sunday night",
                GuardRules.inWindow("12345", ten, seven, MON, 2 * 60));
        assertFalse(GuardRules.inWindow("12345", ten, seven, SAT, 23 * 60));
        assertFalse(GuardRules.inWindow("12345", ten, seven, FRI, 12 * 60));
    }

    @Test
    public void equalEndsMeanAllDay() {
        assertTrue(GuardRules.inWindow("06", 0, 0, SUN, 13 * 60));
        assertFalse(GuardRules.inWindow("06", 0, 0, MON, 13 * 60));
    }

    @Test
    public void eachWhenReadsTheClockItShould() throws Exception {
        JSONObject rest = new JSONObject("{\"live\":true,\"running\":true,\"mode\":\"rest\"}");
        JSONObject paused = new JSONObject("{\"live\":true,\"running\":false,\"mode\":\"focus\"}");
        assertTrue(GuardRules.inForce(rule("{\"when\":\"focus\"}"), focusRunning(), MON, 0));
        assertFalse(GuardRules.inForce(rule("{\"when\":\"focus\"}"), rest, MON, 0));
        assertFalse(GuardRules.inForce(rule("{\"when\":\"focus\"}"), paused, MON, 0));
        assertTrue(GuardRules.inForce(rule("{\"when\":\"session\"}"), rest, MON, 0));
        assertTrue(GuardRules.inForce(rule("{\"when\":\"always\"}"), null, MON, 0));
        JSONObject sched = rule("{\"when\":\"schedule\",\"days\":\"12345\",\"from\":\"09:00\",\"to\":\"17:00\"}");
        assertTrue(GuardRules.inForce(sched, null, MON, 12 * 60));
        assertFalse(GuardRules.inForce(sched, focusRunning(), SAT, 12 * 60));
    }

    /* ---------------- windows ---------------- */

    /** The day in the screenshot this was built from: blocked from nine to
        eleven, with lunch and dinner cut out of it, and a looser overnight. */
    private static JSONObject day() throws Exception {
        return rule("{\"when\":\"schedule\",\"windows\":["
            + "{\"d\":\"0123456\",\"f\":\"09:00\",\"t\":\"23:00\",\"m\":\"block\"},"
            + "{\"d\":\"0123456\",\"f\":\"13:00\",\"t\":\"14:00\",\"m\":\"off\"},"
            + "{\"d\":\"0123456\",\"f\":\"18:00\",\"t\":\"19:00\",\"m\":\"off\"},"
            + "{\"d\":\"0123456\",\"f\":\"23:00\",\"t\":\"08:00\",\"m\":\"limit\"}]}");
    }

    @Test
    public void aWindowSaysWhichWayTheRuleIsInForce() throws Exception {
        JSONObject r = day();
        assertEquals(GuardRules.BLOCK, GuardRules.forceMode(r, null, MON, 10 * 60));
        assertEquals(GuardRules.LIMIT, GuardRules.forceMode(r, null, MON, 2 * 60));
        assertEquals(GuardRules.OFF, GuardRules.forceMode(r, null, MON, 8 * 60 + 30));
    }

    /** The whole grammar: a break written after a block carves a hole in it.
        First-match-wins would mean writing exceptions before the rule they are
        exceptions to, which reads backwards. */
    @Test
    public void theLastWindowThatMatchesWins() throws Exception {
        JSONObject r = day();
        assertEquals(GuardRules.OFF, GuardRules.forceMode(r, null, MON, 13 * 60 + 30));
        assertEquals(GuardRules.OFF, GuardRules.forceMode(r, null, MON, 18 * 60 + 30));
        // and the block closes over again on the far side of each hole
        assertEquals(GuardRules.BLOCK, GuardRules.forceMode(r, null, MON, 14 * 60 + 1));
        assertEquals(GuardRules.BLOCK, GuardRules.forceMode(r, null, MON, 19 * 60 + 1));
    }

    /** A window that runs past midnight is still one window. */
    @Test
    public void anOvernightWindowIsOneWindow() throws Exception {
        JSONObject r = day();
        assertEquals(GuardRules.LIMIT, GuardRules.forceMode(r, null, MON, 23 * 60 + 30));
        assertEquals(GuardRules.LIMIT, GuardRules.forceMode(r, null, MON, 3 * 60));
    }

    /** Days are per window, not per rule. */
    @Test
    public void eachWindowKeepsItsOwnDays() throws Exception {
        JSONObject r = rule("{\"when\":\"schedule\",\"windows\":["
            + "{\"d\":\"12345\",\"f\":\"09:00\",\"t\":\"17:00\",\"m\":\"block\"}]}");
        assertEquals(GuardRules.BLOCK, GuardRules.forceMode(r, null, MON, 12 * 60));
        assertEquals(GuardRules.OFF, GuardRules.forceMode(r, null, SAT, 12 * 60));
    }

    /** The mode is the window’s while the window is the match, so one rule can
        be hard at some hours and soft at others. That is the point of it. */
    @Test
    public void aWindowOverridesTheRulesOwnHardFlag() throws Exception {
        JSONObject soft = rule("{\"when\":\"schedule\",\"hard\":false,\"windows\":["
            + "{\"d\":\"0123456\",\"f\":\"09:00\",\"t\":\"17:00\",\"m\":\"block\"}]}");
        assertEquals(GuardRules.BLOCK, GuardRules.forceMode(soft, null, MON, 12 * 60));
        JSONObject hard = rule("{\"when\":\"schedule\",\"hard\":true,\"windows\":["
            + "{\"d\":\"0123456\",\"f\":\"09:00\",\"t\":\"17:00\",\"m\":\"limit\"}]}");
        assertEquals(GuardRules.LIMIT, GuardRules.forceMode(hard, null, MON, 12 * 60));
    }

    /** A rule written before windows existed must behave exactly as it did. */
    @Test
    public void withoutWindowsNothingChanges() throws Exception {
        JSONObject old = rule("{\"when\":\"schedule\",\"days\":\"12345\",\"from\":\"09:00\",\"to\":\"17:00\",\"hard\":true}");
        assertEquals(GuardRules.BLOCK, GuardRules.forceMode(old, null, MON, 12 * 60));
        assertEquals(GuardRules.OFF, GuardRules.forceMode(old, null, SAT, 12 * 60));
        assertTrue(GuardRules.inForce(old, null, MON, 12 * 60));
        JSONObject empty = rule("{\"when\":\"schedule\",\"windows\":[],\"days\":\"12345\",\"from\":\"09:00\",\"to\":\"17:00\"}");
        assertEquals(GuardRules.LIMIT, GuardRules.forceMode(empty, null, MON, 12 * 60));
    }

    /** A window nobody can read should not block anything. */
    @Test
    public void anUnreadableModeIsABreak() throws Exception {
        JSONObject r = rule("{\"when\":\"schedule\",\"windows\":["
            + "{\"d\":\"0123456\",\"f\":\"00:00\",\"t\":\"00:00\",\"m\":\"nonsense\"}]}");
        assertEquals(GuardRules.OFF, GuardRules.forceMode(r, null, MON, 12 * 60));
    }

    /* ---------------- the decision ---------------- */

    @Test
    public void nothingIsStoodInFrontOfWhileBlockingIsOffOrTheRuleIsNotInForce() throws Exception {
        JSONObject c = cfg(rule("{\"apps\":[\"x.insta\"],\"when\":\"focus\"}"));
        c.put("on", false);
        assertFalse(decide(c, "x.insta", day("{}"), null, null).shield);

        JSONObject c2 = cfg(rule("{\"apps\":[\"x.insta\"],\"when\":\"focus\"}"));
        GuardRules.Verdict v = GuardRules.decide(c2, GuardRules.matchApp(c2, "x.insta"),
                new JSONObject("{\"live\":false}"), day("{}"), null, null, NOW, MON, 600, TOMORROW);
        assertFalse(v.shield);
    }

    @Test
    public void anAllowanceLetsYouThroughUntilItRunsOut() throws Exception {
        JSONObject c = cfg(rule("{\"apps\":[\"x.insta\"],\"pause\":10}"));
        JSONObject allow = new JSONObject().put("x.insta", NOW + 60_000L);
        assertFalse(decide(c, "x.insta", day("{}"), allow, null).shield);
        allow.put("x.insta", NOW - 1);
        GuardRules.Verdict v = decide(c, "x.insta", day("{}"), allow, null);
        assertTrue(v.shield);
        assertTrue(v.way);
        assertEquals(10, v.pause);
    }

    @Test
    public void thePauseGrowsWithEachOpenAndStopsGrowingAtFiveMinutes() throws Exception {
        JSONObject c = cfg(rule("{\"apps\":[\"x.insta\"],\"pause\":10,\"step\":5}"));
        assertEquals(20, decide(c, "x.insta", day("{\"x.insta\":{\"through\":2}}"), null, null).pause);
        assertEquals(300, decide(c, "x.insta", day("{\"x.insta\":{\"through\":200}}"), null, null).pause);
    }

    @Test
    public void aHardRuleHasNoWayThrough() throws Exception {
        GuardRules.Verdict v = decide(cfg(rule("{\"apps\":[\"x.insta\"],\"hard\":true}")),
                "x.insta", day("{}"), null, null);
        assertTrue(v.shield);
        assertFalse(v.way);
        assertEquals("hard", v.why);
    }

    @Test
    public void theLastOpenOfTheDayClosesTheWayUntilMidnight() throws Exception {
        JSONObject c = cfg(rule("{\"apps\":[\"x.insta\"],\"opens\":3,\"after\":\"block\"}"));
        GuardRules.Verdict v = decide(c, "x.insta", day("{\"x.insta\":{\"through\":3}}"), null, null);
        assertFalse(v.way);
        assertEquals("opens", v.why);
        assertEquals(TOMORROW, v.until);
        assertTrue(decide(c, "x.insta", day("{\"x.insta\":{\"through\":2}}"), null, null).way);
    }

    @Test
    public void aLimitSetToKeepPausingOnlyKeepsPausing() throws Exception {
        JSONObject c = cfg(rule("{\"apps\":[\"x.insta\"],\"opens\":3,\"minutes\":10,\"after\":\"pause\"}"));
        GuardRules.Verdict v = decide(c, "x.insta",
                day("{\"x.insta\":{\"through\":9,\"secs\":9000}}"), null, null);
        assertTrue(v.shield);
        assertTrue(v.way);
    }

    @Test
    public void aTimeLimitCutsAnAllowanceShortRatherThanBeingOverrunByIt() throws Exception {
        JSONObject c = cfg(rule("{\"apps\":[\"x.insta\"],\"minutes\":30,\"after\":\"block\"}"));
        JSONObject allow = new JSONObject().put("x.insta", NOW + 14 * 60_000L);
        GuardRules.Verdict v = decide(c, "x.insta", day("{\"x.insta\":{\"secs\":1800}}"), allow, null);
        assertTrue("fourteen minutes of allowance left, and the thirty are used up", v.shield);
        assertFalse(v.way);
        assertEquals("minutes", v.why);
        assertFalse("but one minute short of the limit, the allowance stands",
                decide(c, "x.insta", day("{\"x.insta\":{\"secs\":1740}}"), allow, null).shield);
    }

    @Test
    public void aGroupsLimitIsOneBudgetAcrossEverythingInIt() throws Exception {
        JSONObject c = cfg(rule("{\"apps\":[\"x.insta\",\"x.tiktok\"],\"sites\":[\"reddit.com\"],"
                + "\"opens\":4,\"after\":\"block\"}"));
        JSONObject today = day("{\"x.insta\":{\"through\":2},\"x.tiktok\":{\"through\":1},"
                + "\"site:reddit.com\":{\"through\":1},\"x.other\":{\"through\":9}}");
        GuardRules.Verdict v = decide(c, "x.tiktok", today, null, null);
        assertEquals(4, v.opens);
        assertFalse(v.way);
        assertEquals("opens", v.why);
    }

    @Test
    public void aCooldownRunsFromWhenTheLastAllowanceEnded() throws Exception {
        JSONObject c = cfg(rule("{\"id\":\"soc\",\"apps\":[\"x.insta\"],\"cooldown\":10}"));
        JSONObject last = new JSONObject().put("soc", NOW - 4 * 60_000L);
        GuardRules.Verdict v = decide(c, "x.insta", day("{}"), null, last);
        assertFalse(v.way);
        assertEquals("cooldown", v.why);
        assertEquals(NOW + 6 * 60_000L, v.until);
        last.put("soc", NOW - 11 * 60_000L);
        assertTrue(decide(c, "x.insta", day("{}"), null, last).way);
    }

    @Test
    public void aFailedRollOfTheOddsKeepsTheWayShutForAMinute() throws Exception {
        JSONObject c = cfg(rule("{\"id\":\"soc\",\"apps\":[\"x.insta\"],\"odds\":50}"));
        JSONObject last = new JSONObject().put("soc#no", NOW + 30_000L);
        GuardRules.Verdict v = decide(c, "x.insta", day("{}"), null, last);
        assertFalse(v.way);
        assertEquals("odds", v.why);
        assertEquals(50, decide(c, "x.insta", day("{}"), null, null).odds);
    }

    @Test
    public void quickLooksAreCountedDownFromThreeADay() throws Exception {
        JSONObject c = cfg(rule("{\"apps\":[\"x.insta\"],\"quick\":true}"));
        assertEquals(2, decide(c, "x.insta", day("{\"x.insta\":{\"quick\":1}}"), null, null).quickLeft);
        JSONObject c2 = cfg(rule("{\"apps\":[\"x.insta\"]}"));
        assertEquals(0, decide(c2, "x.insta", day("{}"), null, null).quickLeft);
    }

    /* ---------------- the lock ---------------- */

    private static JSONObject lockedCfg() throws Exception {
        JSONObject c = cfg(rule("{\"apps\":[\"x.insta\"],\"pause\":30}"));
        c.put("lock", new JSONObject("{\"on\":true,\"delay\":10}"));
        return c;
    }

    @Test
    public void aWaitingChangeIsAppliedOnlyOnceItsTimeHasCome() throws Exception {
        JSONObject c = lockedCfg();
        JSONObject looser = cfg(rule("{\"apps\":[],\"pause\":3}"));
        c.put("pending", new JSONObject().put("at", String.valueOf(NOW + 1000)).put("cfg", looser));
        assertSame(c, GuardRules.promote(c, NOW));
        JSONObject after = GuardRules.promote(c, NOW + 1000);
        assertEquals(3, after.getJSONArray("rules").getJSONObject(0).getInt("pause"));
        assertFalse(after.has("pending"));
    }

    @Test
    public void whileLockedASaveCannotLoosenAnythingDirectly() throws Exception {
        JSONObject stored = lockedCfg();
        JSONObject incoming = cfg(rule("{\"apps\":[],\"pause\":3}"));
        JSONObject kept = GuardRules.accept(stored, incoming, NOW);
        assertEquals(30, kept.getJSONArray("rules").getJSONObject(0).getInt("pause"));
        assertTrue(GuardRules.locked(kept));
    }

    @Test
    public void whileLockedAChangeMayOnlyWaitOutTheFullDelay() throws Exception {
        JSONObject looser = cfg(rule("{\"apps\":[],\"pause\":3}"));
        JSONObject early = lockedCfg();
        early.put("pending", new JSONObject().put("at", String.valueOf(NOW + 60_000L)).put("cfg", looser));
        assertFalse("one minute is not ten", GuardRules.accept(lockedCfg(), early, NOW).has("pending"));

        JSONObject fair = lockedCfg();
        fair.put("pending", new JSONObject().put("at", String.valueOf(NOW + 10 * 60_000L)).put("cfg", looser));
        JSONObject kept = GuardRules.accept(lockedCfg(), fair, NOW);
        assertTrue(kept.has("pending"));
        assertEquals(30, kept.getJSONArray("rules").getJSONObject(0).getInt("pause"));
    }

    @Test
    public void aWaitingChangeCanAlwaysBeCancelledAndResendingItKeepsItsTime() throws Exception {
        JSONObject looser = cfg(rule("{\"apps\":[],\"pause\":3}"));
        JSONObject stored = lockedCfg();
        stored.put("pending", new JSONObject().put("at", String.valueOf(NOW + 2 * 60_000L)).put("cfg", looser));
        assertFalse(GuardRules.accept(stored, lockedCfg(), NOW).has("pending"));

        JSONObject again = lockedCfg();
        again.put("pending", new JSONObject().put("at", String.valueOf(NOW + 2 * 60_000L)).put("cfg", looser));
        assertTrue(GuardRules.accept(stored, again, NOW).has("pending"));
    }

    @Test
    public void anUnlockedConfigIsReplacedOutright() throws Exception {
        JSONObject stored = cfg(rule("{\"apps\":[\"x.insta\"],\"pause\":30}"));
        JSONObject incoming = cfg(rule("{\"apps\":[],\"pause\":3}"));
        assertSame(incoming, GuardRules.accept(stored, incoming, NOW));
    }

    /* ---------------- the date ---------------- */

    @Test
    public void movingTheClockForwardDoesNotBuyAFreshDayWhileLocked() {
        long day = 24 * 3_600_000L;
        assertTrue(GuardRules.acceptDay("2026-09-15", "2026-09-15", 5_000, 5_000, true, true));
        assertTrue("unlocked, the wall clock is believed",
                GuardRules.acceptDay("2026-09-15", "2026-09-16", day, 1_000, true, false));
        assertFalse("a day on the wall clock in a second of real time",
                GuardRules.acceptDay("2026-09-15", "2026-09-16", day, 1_000, true, true));
        assertTrue("a night's sleep is a real day",
                GuardRules.acceptDay("2026-09-15", "2026-09-16", 8 * 3_600_000L, 8 * 3_600_000L, true, true));
        assertFalse("and going backwards is never believed while locked",
                GuardRules.acceptDay("2026-09-15", "2026-09-14", 0, 1_000, true, true));
        assertTrue("after a reboot the clocks cannot be compared",
                GuardRules.acceptDay("2026-09-15", "2026-09-16", day, 1_000, false, true));
    }
}
