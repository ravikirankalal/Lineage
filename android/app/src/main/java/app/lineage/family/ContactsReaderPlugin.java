package app.lineage.family;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.provider.ContactsContract;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Reads the phone's contacts (name, phone numbers, emails) for Lineage's "add a relative" suggestions.
 * Read-only: it asks only for READ_CONTACTS and never writes. The list goes to the page in memory;
 * the app stores nothing.
 */
@CapacitorPlugin(
    name = "ContactsReader",
    permissions = { @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = "contacts") }
)
public class ContactsReaderPlugin extends Plugin {

    @PluginMethod
    public void read(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "afterPermission");
            return;
        }
        readAll(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            call.reject("Lineage wasn't allowed to read your contacts.", "denied");
            return;
        }
        readAll(call);
    }

    private void readAll(PluginCall call) {
        new Thread(() -> {
            try {
                ContentResolver cr = getContext().getContentResolver();
                Map<String, JSObject> byId = new LinkedHashMap<>();
                String[] cols = {
                    ContactsContract.Data.CONTACT_ID,
                    ContactsContract.Data.MIMETYPE,
                    ContactsContract.Data.DATA1,
                    ContactsContract.Data.DATA2,
                    ContactsContract.Data.DATA3,
                };
                String where = ContactsContract.Data.MIMETYPE + " IN (?,?,?,?)";
                String[] args = {
                    ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE,
                    ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE,
                    ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE,
                    ContactsContract.CommonDataKinds.Nickname.CONTENT_ITEM_TYPE,
                };
                try (Cursor c = cr.query(ContactsContract.Data.CONTENT_URI, cols, where, args, null)) {
                    if (c != null) {
                        while (c.moveToNext()) {
                            String id = c.getString(0);
                            String mime = c.getString(1);
                            String d1 = c.getString(2);
                            JSObject o = byId.get(id);
                            if (o == null) {
                                o = new JSObject();
                                o.put("id", id);
                                o.put("phones", new JSArray());
                                o.put("emails", new JSArray());
                                byId.put(id, o);
                            }
                            if (ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE.equals(mime)) {
                                o.put("display", d1);
                                o.put("given", c.getString(3)); // DATA2 = GIVEN_NAME
                                o.put("family", c.getString(4)); // DATA3 = FAMILY_NAME
                            } else if (ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE.equals(mime)) {
                                if (d1 != null) o.getJSONArray("phones").put(d1);
                            } else if (ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE.equals(mime)) {
                                if (d1 != null) o.getJSONArray("emails").put(d1);
                            } else if (d1 != null) {
                                o.put("nickname", d1);
                            }
                        }
                    }
                }
                JSArray list = new JSArray();
                for (JSObject o : byId.values()) list.put(o);
                JSObject res = new JSObject();
                res.put("contacts", list);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Couldn't read your contacts.", e);
            }
        }).start();
    }
}
