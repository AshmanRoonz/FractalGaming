package ca.fractalreality.phiresonance;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The page's handle on PlaybackService (called from www/app-bridge.js).
 *
 *   start({ title, text })  enter the foreground with a playback notification; call it from the
 *                           BEGIN SESSION tap, while the app is visible (Android refuses to start a
 *                           foreground service from the background)
 *   stop()                  leave the foreground and remove the notification
 *   'stopRequested' event   the notification's Stop button was pressed; the page stops the session
 *
 * On Android 13+ the first start asks for the notification permission. The service runs either way;
 * without the permission its notification (and the Stop button) is just not shown.
 */
@CapacitorPlugin(
    name = "PlaybackService",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = PlaybackServicePlugin.NOTIFICATIONS) }
)
public class PlaybackServicePlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";

    @Override
    public void load() {
        PlaybackService.setStopListener(() -> notifyListeners("stopRequested", new JSObject()));
    }

    @Override
    protected void handleOnDestroy() {
        PlaybackService.setStopListener(null);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            PermissionState state = getPermissionState(NOTIFICATIONS);
            if (state == PermissionState.PROMPT || state == PermissionState.PROMPT_WITH_RATIONALE) {
                requestPermissionForAlias(NOTIFICATIONS, call, "afterNotificationPermission");
                return;
            }
        }
        startService(call);
    }

    @PermissionCallback
    private void afterNotificationPermission(PluginCall call) {
        startService(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }

    private void startService(PluginCall call) {
        Intent intent = new Intent(getContext(), PlaybackService.class)
            .setAction(PlaybackService.ACTION_START)
            .putExtra(PlaybackService.EXTRA_TITLE, call.getString("title", "Phi Resonance"))
            .putExtra(PlaybackService.EXTRA_TEXT, call.getString("text", "Session playing"));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start the playback service: " + e.getMessage(), e);
        }
    }
}
