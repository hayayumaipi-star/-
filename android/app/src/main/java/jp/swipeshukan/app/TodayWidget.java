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
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Home screen widget: today's top card with "missed" and "done" buttons, the cards left and the
 * streak. Once the day's cards are done it shows the rate. Records made here are kept in
 * "pending" until the app opens and takes them (see WidgetBridgePlugin.takePending).
 */
public class TodayWidget extends AppWidgetProvider {

    static final String PREFS = "today_widget";
    static final Object LOCK = new Object();
    private static final String ACTION_DONE = "jp.swipeshukan.app.WIDGET_DONE";
    private static final String ACTION_MISS = "jp.swipeshukan.app.WIDGET_MISS";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            manager.updateAppWidget(id, views(context));
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_DONE.equals(action) || ACTION_MISS.equals(action)) {
            record(context, ACTION_DONE.equals(action) ? "done" : "pass");
            refreshAll(context);
        }
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class));
        for (int id : ids) {
            manager.updateAppWidget(id, views(context));
        }
    }

    private static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /** Takes the top card off today's queue and queues the record for the app. */
    private static void record(Context context, String type) {
        synchronized (LOCK) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String date = prefs.getString("date", "");
            if (!today().equals(date)) return;
            try {
                JSONArray queue = new JSONArray(prefs.getString("queue", "[]"));
                if (queue.length() == 0) return;
                JSONObject card = queue.getJSONObject(0);
                queue.remove(0);
                JSONArray pending = new JSONArray(prefs.getString("pending", "[]"));
                pending.put(new JSONObject().put("date", date).put("id", card.getString("id")).put("type", type));
                String counter = "done".equals(type) ? "done" : "missed";
                prefs
                    .edit()
                    .putString("queue", queue.toString())
                    .putString("pending", pending.toString())
                    .putInt(counter, prefs.getInt(counter, 0) + 1)
                    .commit();
            } catch (JSONException e) {
                // A malformed queue is replaced the next time the app opens.
            }
        }
    }

    private static RemoteViews views(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        boolean fresh = today().equals(prefs.getString("date", ""));
        int total = prefs.getInt("total", 0);
        int done = prefs.getInt("done", 0);
        int missed = prefs.getInt("missed", 0);
        int streak = prefs.getInt("streak", 0);

        JSONObject card = null;
        int left = 0;
        try {
            JSONArray queue = new JSONArray(prefs.getString("queue", "[]"));
            left = queue.length();
            if (left > 0) card = queue.getJSONObject(0);
        } catch (JSONException e) {
            card = null;
        }

        String label = context.getString(R.string.widget_label);
        String big;
        String small;
        boolean showCard = false;
        if (!fresh) {
            // A summary from an earlier day is out of date: show a plain prompt until the app opens again.
            big = context.getString(R.string.widget_stale_big);
            small = context.getString(R.string.widget_stale_small);
        } else if (card != null) {
            showCard = true;
            big = "";
            small = "";
            label = context.getString(R.string.widget_left, left);
            views.setTextViewText(R.id.widget_card_name, card.optString("name"));
            views.setInt(R.id.widget_card, "setBackgroundResource", cardBackground(card.optString("color")));
        } else if (total > 0) {
            // Finished, possibly on the widget itself, so the rate and streak are worked out here.
            streak = prefs.getInt("streakDone", streak);
            big = Math.round(done * 100f / total) + "%";
            small = missed > 0 ? context.getString(R.string.widget_some_done, total, done) : context.getString(R.string.widget_all_done);
        } else {
            big = prefs.getString("big", "");
            small = prefs.getString("small", "");
        }

        views.setTextViewText(R.id.widget_label, label);
        views.setTextViewText(R.id.widget_streak, "🔥" + streak);
        views.setViewVisibility(R.id.widget_streak, streak > 0 ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_card, showCard ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_buttons, showCard ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_summary, showCard ? View.GONE : View.VISIBLE);
        views.setTextViewText(R.id.widget_big, big);
        views.setTextViewText(R.id.widget_small, small);

        views.setOnClickPendingIntent(R.id.widget_done, broadcast(context, ACTION_DONE, 1));
        views.setOnClickPendingIntent(R.id.widget_miss, broadcast(context, ACTION_MISS, 2));
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("jp.swipeshukan.app://today"), context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, tap);
        return views;
    }

    private static PendingIntent broadcast(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, TodayWidget.class).setAction(action);
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static int cardBackground(String color) {
        switch (color) {
            case "orange":
                return R.drawable.widget_card_orange;
            case "pink":
                return R.drawable.widget_card_pink;
            case "purple":
                return R.drawable.widget_card_purple;
            case "blue":
                return R.drawable.widget_card_blue;
            case "yellow":
                return R.drawable.widget_card_yellow;
            default:
                return R.drawable.widget_card_mint;
        }
    }
}
