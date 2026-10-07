package jp.swipeshukan.app;

import android.content.Context;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Receives today's summary from the web app and redraws the home screen widget. */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        Integer streak = call.getInt("streak", 0);
        context
            .getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString("date", call.getString("date", ""))
            .putString("big", call.getString("big", ""))
            .putString("small", call.getString("small", ""))
            .putInt("streak", streak == null ? 0 : streak)
            .apply();
        TodayWidget.refreshAll(context);
        call.resolve();
    }
}
