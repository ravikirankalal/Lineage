package app.lineage.family;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own read-only contacts plugin (see ContactsReaderPlugin).
        registerPlugin(ContactsReaderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
