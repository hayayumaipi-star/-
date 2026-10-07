package jp.swipeshukan.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Home screen widget with today's progress and the streak. Tapping it opens the card stack. */
public class TodayWidget extends AppWidgetProvider {

    static final String PREFS = "today_widget";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            manager.updateAppWidget(id, views(context));
        }
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class));
        for (int id : ids) {
            manager.updateAppWidget(id, views(context));
        }
    }

    private static RemoteViews views(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        // A summary saved on an earlier day is out of date: show a plain prompt until the app opens again.
        boolean fresh = today.equals(prefs.getString("date", ""));
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        views.setTextViewText(R.id.widget_big, fresh ? prefs.getString("big", "") : context.getString(R.string.widget_stale_big));
        views.setTextViewText(R.id.widget_small, fresh ? prefs.getString("small", "") : context.getString(R.string.widget_stale_small));

        int streak = prefs.getInt("streak", 0);
        views.setTextViewText(R.id.widget_streak, "🔥" + streak);
        views.setViewVisibility(R.id.widget_streak, streak > 0 ? View.VISIBLE : View.GONE);

        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("jp.swipeshukan.app://today"), context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, tap);
        return views;
    }
}
