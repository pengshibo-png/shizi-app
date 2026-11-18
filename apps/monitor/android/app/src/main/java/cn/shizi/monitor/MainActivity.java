package cn.shizi.monitor;

import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

/**
 * 家属端主 Activity。
 *
 * 家属端不随时间换装（老人端才有纸/墨两套），界面恒定为「纸」，
 * 所以这里把状态栏 / 导航栏那两条固定成纸色画布，与页面底色一致。
 *
 * 为什么要写在原生层（原因与老人端相同，详见 learner/MainActivity.java 的注释）：
 * Capacitor 在 WebView 版本较旧时会给 decorView 加内边距、把 env(safe-area-inset-*) 置 0，
 * 系统栏那一条露出的是 decorView 的底色，`setStatusBarColor` 改不动它。
 */
public class MainActivity extends BridgeActivity {

    /** 与 --shi-color-canvas（纸）保持一致 */
    private static final int CANVAS_PAPER = 0xFFF1F4F7;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applySystemBars();
    }

    private void applySystemBars() {
        Window window = getWindow();
        window.setBackgroundDrawable(new ColorDrawable(CANVAS_PAPER));
        View decor = window.getDecorView();
        decor.setBackgroundColor(CANVAS_PAPER);
        decor.post(() -> decor.setBackgroundColor(CANVAS_PAPER));

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(CANVAS_PAPER);
            window.setNavigationBarColor(CANVAS_PAPER);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // 浅底配深色图标
            int flags = decor.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(flags);
        }
    }
}
