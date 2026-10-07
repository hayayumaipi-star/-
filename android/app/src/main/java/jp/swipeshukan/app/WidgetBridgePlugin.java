package jp.swipeshukan.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Connects the web app and the home screen widget: the app sends today's cards and counts,
 * and collects the records made on the widget while the app was closed.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        context
            .getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString("date", call.getString("date", ""))
            .putString("big", call.getString("big", ""))
            .putString("small", call.getString("small", ""))
            .putString("queue", call.getString("queue", "[]"))
            .putInt("total", intOf(call, "total"))
            .putInt("done", intOf(call, "done"))
            .putInt("missed", intOf(call, "missed"))
            .putInt("streak", intOf(call, "streak"))
            .putInt("streakDone", intOf(call, "streakDone"))
            .apply();
        TodayWidget.refreshAll(context);
        call.resolve();
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE);
        String actions;
        synchronized (TodayWidget.LOCK) {
            actions = prefs.getString("pending", "[]");
            prefs.edit().remove("pending").commit();
        }
        JSObject result = new JSObject();
        result.put("actions", actions);
        call.resolve(result);
    }

    private static int intOf(PluginCall call, String key) {
        Integer value = call.getInt(key, 0);
        return value == null ? 0 : value;
    }
}
