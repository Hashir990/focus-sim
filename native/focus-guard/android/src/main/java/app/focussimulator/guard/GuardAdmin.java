package app.focussimulator.guard;

import android.app.admin.DeviceAdminReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

/**
 * Device admin, for one purpose: an app that is a device admin cannot be
 * uninstalled until it stops being one.
 *
 * <p><b>It asks for no policies at all</b> ({@code res/xml/guard_admin.xml} is
 * empty). It cannot lock the phone, wipe it, or read anything; it exists so
 * that removing the blocker is two steps, and while the lock is on the second
 * step — this screen in Settings — is one the blocker stands in front of
 * (BlockService.guardSettings). That is ScreenZen's uninstall protection.
 */
public class GuardAdmin extends DeviceAdminReceiver {

    static ComponentName component(Context c) {
        return new ComponentName(c, GuardAdmin.class);
    }

    @Override
    public CharSequence onDisableRequested(Context c, Intent intent) {
        return "focUS simulator's app blocking will be able to be uninstalled.";
    }
}
