package jp.swipeshukan.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import androidx.annotation.RequiresApi;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Home screen widget: today's top card with "missed" and "done" buttons, a progress bar, the
 * cards left and the streak; the rate once the day is done. Records made here are kept in
 * "pending" until the app opens and takes them (see WidgetBridgePlugin.takePending), and the
 * last one can be undone from the widget until then.
 */
public class TodayWidget extends AppWidgetProvider {

    static final String PREFS = "today_widget";
    static final Object LOCK = new Object();
    private static final String ACTION_DONE = "jp.swipeshukan.app.WIDGET_DONE";
    private static final String ACTION_MISS = "jp.swipeshukan.app.WIDGET_MISS";
    private static final String ACTION_UNDO = "jp.swipeshukan.app.WIDGET_UNDO";

    /** How the widget is drawn at a size: narrow ones get icon-only buttons, taller ones bigger type. */
    private static final class Size {
        final boolean compact;
        final float nameSp;
        final float bigSp;

        Size(boolean compact, float nameSp, float bigSp) {
            this.compact = compact;
            this.nameSp = nameSp;
            this.bigSp = bigSp;
        }
    }

    private static final Size SMALL = new Size(true, 16, 26);
    private static final Size MEDIUM = new Size(false, 20, 32);
    private static final Size LARGE = new Size(false, 28, 44);

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            manager.updateAppWidget(id, viewsFor(context, manager, id));
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, viewsFor(context, manager, id));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_DONE.equals(action) || ACTION_MISS.equals(action)) {
            record(context, ACTION_DONE.equals(action) ? "done" : "pass");
            refreshAll(context);
        } else if (ACTION_UNDO.equals(action)) {
            undo(context);
            refreshAll(context);
        }
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class));
        for (int id : ids) {
            manager.updateAppWidget(id, viewsFor(context, manager, id));
        }
    }

    private static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /** Takes the top card off today's queue and keeps the record for the app. */
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
                pending.put(new JSONObject().put("date", date).put("id", card.getString("id")).put("type", type).put("card", card));
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

    /** Puts the last widget record back, as long as the app hasn't taken it yet. */
    private static void undo(Context context) {
        synchronized (LOCK) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            try {
                JSONArray pending = new JSONArray(prefs.getString("pending", "[]"));
                if (pending.length() == 0) return;
                JSONObject last = pending.getJSONObject(pending.length() - 1);
                if (!today().equals(last.optString("date")) || !today().equals(prefs.getString("date", ""))) return;
                pending.remove(pending.length() - 1);
                JSONArray queue = new JSONArray(prefs.getString("queue", "[]"));
                JSONArray restored = new JSONArray().put(last.getJSONObject("card"));
                for (int i = 0; i < queue.length(); i++) restored.put(queue.get(i));
                String counter = "done".equals(last.optString("type")) ? "done" : "missed";
                prefs
                    .edit()
                    .putString("queue", restored.toString())
                    .putString("pending", pending.toString())
                    .putInt(counter, Math.max(0, prefs.getInt(counter, 0) - 1))
                    .commit();
            } catch (JSONException e) {
                // Nothing to undo.
            }
        }
    }

    private static RemoteViews viewsFor(Context context, AppWidgetManager manager, int id) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return responsive(context);
        Bundle options = manager.getAppWidgetOptions(id);
        int width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 180);
        int height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 110);
        return build(context, width < 180 ? SMALL : height >= 230 ? LARGE : MEDIUM);
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private static RemoteViews responsive(Context context) {
        Map<SizeF, RemoteViews> sizes = new HashMap<>();
        sizes.put(new SizeF(110f, 110f), build(context, SMALL));
        sizes.put(new SizeF(180f, 110f), build(context, MEDIUM));
        sizes.put(new SizeF(180f, 230f), build(context, LARGE));
        return new RemoteViews(sizes);
    }

    private static RemoteViews build(Context context, Size size) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        boolean fresh = today().equals(prefs.getString("date", ""));
        int total = prefs.getInt("total", 0);
        int done = prefs.getInt("done", 0);
        int missed = prefs.getInt("missed", 0);
        int streak = prefs.getInt("streak", 0);

        JSONObject card = null;
        int left = 0;
        int pending = 0;
        try {
            JSONArray queue = new JSONArray(prefs.getString("queue", "[]"));
            left = queue.length();
            if (left > 0) card = queue.getJSONObject(0);
            pending = new JSONArray(prefs.getString("pending", "[]")).length();
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
            String name = card.optString("name");
            views.setTextViewText(R.id.widget_card_name, name);
            views.setTextViewTextSize(R.id.widget_card_name, TypedValue.COMPLEX_UNIT_SP, size.nameSp);
            views.setInt(R.id.widget_card, "setBackgroundResource", cardBackground(card.optString("color")));
            views.setTextViewText(R.id.widget_miss, context.getString(size.compact ? R.string.widget_miss_icon : R.string.widget_miss_button));
            views.setTextViewText(R.id.widget_done, context.getString(size.compact ? R.string.widget_done_icon : R.string.widget_done_button));
            views.setContentDescription(R.id.widget_miss, context.getString(R.string.widget_miss_description, name));
            views.setContentDescription(R.id.widget_done, context.getString(R.string.widget_done_description, name));
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
        views.setViewVisibility(R.id.widget_streak, fresh && streak > 0 ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_undo, fresh && pending > 0 ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_progress, fresh && total > 0 ? View.VISIBLE : View.GONE);
        views.setProgressBar(R.id.widget_progress, Math.max(total, 1), done + missed, false);
        views.setViewVisibility(R.id.widget_card, showCard ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_buttons, showCard ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_summary, showCard ? View.GONE : View.VISIBLE);
        views.setTextViewText(R.id.widget_big, big);
        views.setTextViewTextSize(R.id.widget_big, TypedValue.COMPLEX_UNIT_SP, size.bigSp);
        views.setTextViewText(R.id.widget_small, small);

        views.setOnClickPendingIntent(R.id.widget_done, broadcast(context, ACTION_DONE, 1));
        views.setOnClickPendingIntent(R.id.widget_miss, broadcast(context, ACTION_MISS, 2));
        views.setOnClickPendingIntent(R.id.widget_undo, broadcast(context, ACTION_UNDO, 3));
        PendingIntent open = openApp(context);
        views.setOnClickPendingIntent(R.id.widget_root, open);
        views.setOnClickPendingIntent(R.id.widget_card, open);
        return views;
    }

    private static PendingIntent openApp(Context context) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("jp.swipeshukan.app://today"), context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
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
