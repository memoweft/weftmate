package com.memoweft.weftmate.mobile;

import android.inputmethodservice.InputMethodService;
import android.graphics.Color;
import android.view.View;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Real Android IME, test APK only. Java keeps this standalone service free of target APK dependencies. */
public class Ui2vTestIme extends InputMethodService {
    @Override public View onCreateInputView() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(224, 226, 229));
        TextView label = new TextView(this);
        label.setText("UI-2v · Android test keyboard");
        label.setTextColor(Color.BLACK);
        label.setGravity(Gravity.CENTER);
        root.addView(label, new LinearLayout.LayoutParams(-1, dp(32)));
        for (String letters : new String[]{"qwertyuiop", "asdfghjkl", "zxcvbnm"}) {
            LinearLayout row = new LinearLayout(this);
            for (int i = 0; i < letters.length(); i++) {
                String letter = letters.substring(i, i + 1);
                Button button = new Button(this);
                button.setText(letter);
                button.setOnClickListener(v -> { if (getCurrentInputConnection() != null) getCurrentInputConnection().commitText(letter, 1); });
                row.addView(button, new LinearLayout.LayoutParams(0, dp(56), 1f));
            }
            root.addView(row, new LinearLayout.LayoutParams(-1, dp(56)));
        }
        Button space = new Button(this);
        space.setText("Space");
        space.setOnClickListener(v -> { if (getCurrentInputConnection() != null) getCurrentInputConnection().commitText(" ", 1); });
        root.addView(space, new LinearLayout.LayoutParams(-1, dp(56)));
        return root;
    }
    private int dp(int value) { return (int)(value * getResources().getDisplayMetrics().density); }
}
