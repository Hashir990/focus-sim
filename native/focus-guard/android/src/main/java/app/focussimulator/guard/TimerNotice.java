package app.focussimulator.guard;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The ongoing notification, and the alarm that ends the block.
 *
 * <p><b>The countdown is drawn by Android, not by us.</b> {@code setWhen} plus
 * {@code setChronometerCountDown} hands the system an instant and lets it tick
 * the number down itself. That is the whole reason this is worth doing natively:
 * a notification the app has to wake up and rewrite every second is wrong the
 * moment the app is frozen, which is exactly when it is the only thing you can
 * see. The app posts this once and the seconds move on their own with the
 * process dead.
 *
 * <p><b>Two buttons, not three.</b> Stop is always there. The other one is Pause
 * while it runs and Continue while it is paused, because the third would be a
 * control that does nothing to the state it is offered in.
 *
 * <p><b>And an alarm for the end.</b> Handed to AlarmManager when the block
 * starts, so the end announces itself from a pocket whether or not the web view
 * is ever given another instruction. This is the half that matters; the ongoing
 * notification is the half you can see.
 */
final class TimerNotice {
    private TimerNotice() {}

    static final String CH_TIMER = "focus-timer";
    static final String CH_DONE = "focus-done";

    static final int ID_TIMER = 8801;
    static final int ID_DONE = 8802;

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        /* Low, and silent. A block running is a state, not an event: it must be
           readable at a glance and must never make a sound, because the one
           thing worse than a focus app is a focus app that interrupts you. */
        NotificationChannel run = new NotificationChannel(CH_TIMER, "Running timer", NotificationManager.IMPORTANCE_LOW);
        run.setDescription("The block you are in, while the app is in the background.");
        run.setShowBadge(false);
        run.setSound(null, null);
        nm.createNotificationChannel(run);

        /* The end of a block is the opposite: it is the one moment the app is
           allowed to interrupt, and it is the only reason it was in your pocket. */
        NotificationChannel done = new NotificationChannel(CH_DONE, "Block finished", NotificationManager.IMPORTANCE_HIGH);
        done.setDescription("When a focus block or a break runs out.");
        nm.createNotificationChannel(done);
    }

    private static PendingIntent openApp(Context c) {
        Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (i == null) i = new Intent();
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 0, i, flags());
    }

    private static PendingIntent command(Context c, String cmd) {
        Intent i = new Intent(c, NoticeReceiver.class)
                .setAction(NoticeReceiver.ACT_CMD)
                .putExtra("cmd", cmd);
        /* A distinct request code per command. With one code the three intents
           are "equal" as far as PendingIntent is concerned and the last one to
           be created quietly replaces the extras on all of them, so every button
           does whatever the last button built does. */
        return PendingIntent.getBroadcast(c, cmd.hashCode(), i, flags());
    }

    /**
     * Immutable, always. Every intent this class builds is complete when it is
     * built - nothing outside fills anything in - and a mutable PendingIntent
     * handed to the notification shade is a hole for no benefit.
     */
    private static int flags() {
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) f |= PendingIntent.FLAG_IMMUTABLE;
        return f;
    }

    private static String hhmm(long at) {
        return new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(at));
    }

    /** The paused reading, in the same shape the chronometer counts in, so
        pausing does not change what the number looks like. */
    private static String left(long ms) {
        long s = Math.max(0, ms / 1000);
        long m = s / 60;
        if (m >= 60) {
            return m / 60 + ":" + String.format(Locale.US, "%02d", m % 60)
                    + ":" + String.format(Locale.US, "%02d", s % 60);
        }
        return m + ":" + String.format(Locale.US, "%02d", s % 60);
    }

    /** Post the ongoing notification from whatever the mirror currently says. */
    static void show(Context c) {
        JSONObject t = GuardStore.timer(c);
        if (!t.optBoolean("live", false)) { hide(c); return; }

        channels(c);
        boolean running = t.optBoolean("running", false);
        boolean focus = "focus".equals(t.optString("mode", "focus"));
        long endAt = t.optLong("endAt", 0);
        long remaining = t.optLong("remainingMs", 0);

        String what = focus ? "Focusing" : "On a break";
        String when = (focus ? "Ends at " : "Back at ") + hhmm(endAt);

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_TIMER)
                .setSmallIcon(R.drawable.ic_guard_notice)
                .setContentTitle(what)
                .setOngoing(true)
                .setSilent(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(openApp(c));

        /* **The time left is the headline, and the system still ticks it.**

           It used to live in the `when` slot, which is where
           `setUsesChronometer` puts it: small, top right, beside the app name,
           with "Ends at 14:32" given the whole content line underneath. That is
           the wrong way round. The question this notification answers is how
           long is left; what time it finishes is the thing you look for second.

           A Chronometer is the only widget Android counts down on its own, and
           the only way to put one anywhere but that slot is to hand the shade a
           layout with one in it. So the body is ours and the countdown is
           thirty-four points of it; everything else about the notification -
           the icon, the app name, the buttons - is still the system's, which is
           what DecoratedCustomViewStyle means.

           The app posts this once. The seconds move with the process dead. */
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.guard_notice);
        rv.setTextViewText(R.id.notice_what, what);

        if (running) {
            /* The base is on the elapsed-realtime clock, not the wall clock,
               which is what Chronometer counts against. */
            long base = SystemClock.elapsedRealtime() + Math.max(0, endAt - System.currentTimeMillis());
            rv.setChronometer(R.id.notice_clock, base, null, true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                rv.setChronometerCountDown(R.id.notice_clock, true);
            }
            rv.setTextViewText(R.id.notice_end, when);
            b.setContentText(when);
            b.addAction(R.drawable.ic_guard_pause, "Pause", command(c, "pause"));
        } else {
            /* Paused: nothing to tick. The widget is stopped and told what to
               read, because a frozen chronometer still shows whatever it last
               counted to rather than the number that matters. */
            rv.setChronometer(R.id.notice_clock, SystemClock.elapsedRealtime(), null, false);
            rv.setTextViewText(R.id.notice_clock, left(remaining));
            rv.setTextViewText(R.id.notice_end, "Paused");
            b.setContentText("Paused - " + left(remaining) + " left");
            b.addAction(R.drawable.ic_guard_play, "Continue", command(c, "resume"));
        }
        b.addAction(R.drawable.ic_guard_stop, "Stop", command(c, "stop"));
        b.setStyle(new NotificationCompat.DecoratedCustomViewStyle());
        b.setCustomContentView(rv);
        b.setCustomBigContentView(rv);

        try {
            NotificationManagerCompat.from(c).notify(ID_TIMER, b.build());
        } catch (SecurityException ignored) {
            /* Notifications refused. A perfectly good answer: the app carries on
               and simply stops being able to say anything from outside itself. */
        }
    }

    static void hide(Context c) {
        try {
            NotificationManagerCompat.from(c).cancel(ID_TIMER);
        } catch (Exception ignored) {}
    }

    /** The alert at the end of a block. Fired by the alarm, not by the app. */
    static void done(Context c, boolean focus) {
        channels(c);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_DONE)
                .setSmallIcon(R.drawable.ic_guard_notice)
                .setContentTitle(focus ? "Focus block done" : "Break over")
                .setContentText(focus ? "Time for a break." : "Back to it when you are ready.")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(openApp(c));
        try {
            NotificationManagerCompat.from(c).notify(ID_DONE, b.build());
        } catch (SecurityException ignored) {}
    }

    /* ---------------- the alarm ---------------- */

    private static PendingIntent alarm(Context c) {
        Intent i = new Intent(c, NoticeReceiver.class).setAction(NoticeReceiver.ACT_DONE);
        return PendingIntent.getBroadcast(c, 991, i, flags());
    }

    static void arm(Context c, long at) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null || at <= System.currentTimeMillis()) return;
        PendingIntent pi = alarm(c);
        try {
            boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
            if (exact) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                /* Exact alarms revoked. Inexact-while-idle can slide by a few
                   minutes, which is worse than the real thing and much better
                   than silence - and the app still puts the clock right the
                   moment it is looked at, because the countdown was never
                   counting ticks in the first place. */
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Exception ignored) {}
    }

    static void disarm(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try { am.cancel(alarm(c)); } catch (Exception ignored) {}
    }

    /** Post or clear the ongoing notice and re-arm the alarm, from the mirror. */
    static void sync(Context c, boolean showOngoing) {
        JSONObject t = GuardStore.timer(c);
        boolean live = t.optBoolean("live", false);
        boolean running = t.optBoolean("running", false);
        if (live && running) arm(c, t.optLong("endAt", 0)); else disarm(c);
        if (showOngoing && live) show(c); else hide(c);
    }
}
