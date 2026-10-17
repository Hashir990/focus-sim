package app.focussimulator.guard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.View;

/**
 * The ring on the shield: a track, and an arc that empties as the pause runs out.
 *
 * <p>Drawn rather than assembled from a ProgressBar because the two things that
 * make it read as breathing rather than as loading - a round cap and a thick,
 * softly coloured track - are exactly the two a themed ProgressBar fights you
 * over on every Android version.
 *
 * <p>Starts at the top and empties clockwise. The stroke is drawn inside the
 * bounds by half its width; a stroked circle is centred on its path, so a ring
 * laid out to the edge of its box loses half of itself off every side.
 */
public class RingView extends View {

    private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arc = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF box = new RectF();
    private float amount = 1f;

    public RingView(Context c) { this(c, null); }

    public RingView(Context c, AttributeSet a) {
        super(c, a);
        float w = getResources().getDisplayMetrics().density * 7f;
        track.setStyle(Paint.Style.STROKE);
        track.setStrokeWidth(w);
        track.setColor(0x1AFFFFFF);
        arc.setStyle(Paint.Style.STROKE);
        arc.setStrokeWidth(w);
        arc.setStrokeCap(Paint.Cap.ROUND);
        arc.setColor(0xFF4FE0C8);
    }

    /** 1 at the start of the pause, 0 when it is over. */
    public void setAmount(float v) {
        amount = Math.max(0f, Math.min(1f, v));
        invalidate();
    }

    @Override
    protected void onDraw(Canvas c) {
        float inset = arc.getStrokeWidth() / 2f;
        box.set(inset, inset, getWidth() - inset, getHeight() - inset);
        c.drawOval(box, track);
        if (amount > 0f) c.drawArc(box, -90f, 360f * amount, false, arc);
    }
}
