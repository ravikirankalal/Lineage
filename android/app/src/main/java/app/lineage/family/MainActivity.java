package app.lineage.family;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** The logo on green, drawn ON TOP of the web view until the page has drawn (see LaunchCoverPlugin). */
    private View cover;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own plugins: read-only contacts, and removing the launch cover.
        registerPlugin(ContactsReaderPlugin.class);
        registerPlugin(LaunchCoverPlugin.class);
        super.onCreate(savedInstanceState);

        // Android's launch screen shows the same logo on green, then hands over to this cover, so the
        // start looks like one screen until Lineage is ready. Safety net: gone after 10 s regardless.
        cover = new View(this);
        cover.setBackgroundResource(R.drawable.launch_background);
        cover.setClickable(true); // nothing underneath can be tapped while it's up
        addContentView(cover, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        new Handler(Looper.getMainLooper()).postDelayed(this::hideCover, 10_000);
    }

    /** Fade the launch cover out (once; later calls do nothing). */
    public void hideCover() {
        runOnUiThread(() -> {
            final View v = cover;
            if (v == null) return;
            cover = null;
            v.animate().alpha(0f).setDuration(200).withEndAction(() -> {
                if (v.getParent() instanceof ViewGroup) ((ViewGroup) v.getParent()).removeView(v);
            }).start();
        });
    }
}
