package app.chartterminal;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.text.InputType;
import android.view.inputmethod.EditorInfo;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.FrameLayout;

/** prompt()/confirm()/alert() as plain dark native dialogs, without the "The page at https://... says:" title; the web app uses prompt() for names and prices. */
public class JsDialogs extends WebChromeClient {
    private static boolean gone(Context c) { return c instanceof Activity && ((Activity) c).isFinishing(); }

    private static AlertDialog.Builder builder(Context c, String msg) {
        return new AlertDialog.Builder(c, android.R.style.Theme_DeviceDefault_Dialog_Alert).setMessage(msg);
    }

    @Override public boolean onJsAlert(WebView v, String url, String msg, JsResult r) {
        if (gone(v.getContext())) { r.cancel(); return true; }
        builder(v.getContext(), msg).setPositiveButton(android.R.string.ok, (d, w) -> r.confirm()).setOnCancelListener(d -> r.cancel()).show();
        return true;
    }

    @Override public boolean onJsConfirm(WebView v, String url, String msg, JsResult r) {
        if (gone(v.getContext())) { r.cancel(); return true; }
        builder(v.getContext(), msg).setPositiveButton(android.R.string.ok, (d, w) -> r.confirm())
            .setNegativeButton(android.R.string.cancel, (d, w) -> r.cancel()).setOnCancelListener(d -> r.cancel()).show();
        return true;
    }

    @Override public boolean onJsPrompt(WebView v, String url, String msg, String def, JsPromptResult r) {
        Context c = v.getContext();
        if (gone(c)) { r.cancel(); return true; }
        EditText in = new EditText(c);
        in.setText(def == null ? "" : def);
        in.setSingleLine(true);
        in.setImeOptions(EditorInfo.IME_ACTION_DONE);
        boolean num = false;
        if (def != null && !def.isEmpty()) try { Double.parseDouble(def); num = true; } catch (NumberFormatException e) { /* text prompt */ }
        in.setInputType(num ? InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL : InputType.TYPE_CLASS_TEXT);
        in.selectAll();
        FrameLayout box = new FrameLayout(c);
        int pad = (int) (20 * c.getResources().getDisplayMetrics().density);
        box.setPadding(pad, 0, pad, 0);
        box.addView(in, new FrameLayout.LayoutParams(-1, -2));
        AlertDialog d = builder(c, msg).setView(box)
            .setPositiveButton(android.R.string.ok, (x, w) -> r.confirm(in.getText().toString()))
            .setNegativeButton(android.R.string.cancel, (x, w) -> r.cancel())
            .setOnCancelListener(x -> r.cancel()).create();
        in.setOnEditorActionListener((t, id, e) -> { d.getButton(DialogInterface.BUTTON_POSITIVE).performClick(); return true; });
        d.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        d.show();
        in.requestFocus();
        return true;
    }
}
