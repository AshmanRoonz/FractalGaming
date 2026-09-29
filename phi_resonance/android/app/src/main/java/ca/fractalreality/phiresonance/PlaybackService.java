package ca.fractalreality.phiresonance;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Keeps a Phi Resonance session audible with the screen off.
 *
 * The sound itself is made by the Web Audio code in the WebView (www/index.html); this service makes
 * no sound. It exists because Android 17 silences audio from an app that has neither a visible
 * activity nor a foreground service of type mediaPlayback, and because a playing session should show
 * a notification (with a Stop button) while the phone is locked. PlaybackServicePlugin starts it
 * when a session starts and stops it when the session ends.
 */
public class PlaybackService extends Service {

    static final String ACTION_START = "ca.fractalreality.phiresonance.action.START";
    static final String ACTION_STOP = "ca.fractalreality.phiresonance.action.STOP";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";

    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 1618;

    /** Told when the notification's Stop button is pressed; the plugin forwards it to the page. */
    interface StopListener {
        void onStopRequested();
    }

    private static volatile StopListener stopListener;

    static void setStopListener(@Nullable StopListener listener) {
        stopListener = listener;
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            StopListener listener = stopListener;
            if (listener != null) listener.onStopRequested();
            stopPlayback();
            return START_NOT_STICKY;
        }

        // ACTION_START (or anything else): post the notification and enter the foreground at once.
        // After startForegroundService() the system allows only a few seconds for this call.
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        Notification notification = buildNotification(
            title != null ? title : getString(R.string.app_name),
            text != null ? text : "Session playing"
        );
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
        // Not sticky: if the system ever kills the process, the WebView and its sound are gone too,
        // so there is nothing to bring back.
        return START_NOT_STICKY;
    }

    /** Swiping the app away from Recents ends the session: no WebView, no sound, no notification. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopPlayback();
        super.onTaskRemoved(rootIntent);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void stopPlayback() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private Notification buildNotification(String title, String text) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while a session is playing, with a Stop button.");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }

        int immutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openApp = null;
        if (open != null) {
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            openApp = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | immutable);
        }

        Intent stop = new Intent(this, PlaybackService.class).setAction(ACTION_STOP);
        PendingIntent stopSession = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_UPDATE_CURRENT | immutable);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_phi)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openApp)
            .addAction(0, "Stop", stopSession)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }
}
