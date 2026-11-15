package app.lineage.family;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the page remove the launch cover (logo on green) once it has something to show. */
@CapacitorPlugin(name = "LaunchCover")
public class LaunchCoverPlugin extends Plugin {

    @PluginMethod
    public void hide(PluginCall call) {
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).hideCover();
        call.resolve();
    }
}
