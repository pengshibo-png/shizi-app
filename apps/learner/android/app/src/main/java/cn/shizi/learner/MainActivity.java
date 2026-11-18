package cn.shizi.learner;

import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;
import java.util.Calendar;

/**
 * 识字（老人学习端）主 Activity。
 *
 * 只做一件事：让状态栏 / 导航栏那两条跟界面的「纸 / 墨」一致。
 * 深色界面上顶一条浅色横条是这个 App 最先被看出来的破绽（实测截图确认过）。
 *
 * 两条路分别处理，因为系统的行为在 Android 11 处断开了：
 *
 *  A) Android 11+（API 30+，本项目的目标机型大多在这里）：
 *     `setDecorFitsSystemWindows(false)` 让 WebView 铺到系统栏后面。
 *     系统栏本身是透明的，那两条由**页面自己的画布色**来画
 *     （CSS 用 env(safe-area-inset-*) 避让内容），主题切纸/墨时天然同步，
 *     连用户手动锁定主题也不会露馅。
 *     ——实测教训：Android 11+ 上 `setStatusBarColor` 不起作用，
 *     WebView 被内边距顶开时露出的是窗口底色，所以之前怎么设都是那条浅色。
 *
 *  B) Android 8–10（API 24–29，老人机里还有相当比例）：
 *     保持系统原有布局（WebView 在栏下方），直接给两条栏设成画布色。
 *
 * 纸/墨判定与 packages/ui/src/theme.ts 的 themeForHour 一致：06:00–18:00 用纸，其余用墨。
 * A 路不受这里影响（画布自己会跟上），B 路在跨过 18:00 后于 onResume 重算一次。
 */
public class MainActivity extends BridgeActivity {

    /** 与 --shi-color-canvas、res/values(-night)/colors.xml 保持同步 */
    private static final int CANVAS_PAPER = 0xFFF1F4F7;
    private static final int CANVAS_INK = 0xFF0D141E;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applySystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        // BridgeActivity.onResume 是 public，这里不能降低可见性
        applySystemBars();
    }

    private boolean isPaperHour() {
        int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        return hour >= 6 && hour < 18;
    }

    private void applySystemBars() {
        boolean paper = isPaperHour();
        int canvas = paper ? CANVAS_PAPER : CANVAS_INK;
        Window window = getWindow();

        // 首帧（JS 还没跑）也铺成画布色，避免出现白色闪烁
        window.setBackgroundDrawable(new ColorDrawable(canvas));

        // 关键：Capacitor 在 WebView 版本较旧（<140，模拟器就是这种）时不会走
        // 「insets 透传给 CSS」那条路，而是给 **decorView 加内边距**、把 env(safe-area-*) 置 0。
        // 于是系统栏那两条正好是 decorView 的 padding 区域 —— 要改的是它的底色，
        // 改 windowBackground 或 setStatusBarColor 都管不到（实测两条都试过，色值不变）。
        View decor = window.getDecorView();
        decor.setBackgroundColor(canvas);
        // Capacitor 的 insets 监听在布局阶段还会再来一次，post 一下保证我们是最后写的
        decor.post(() -> decor.setBackgroundColor(canvas));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // A 路：内容画到系统栏后面，那两条交给页面画布
            window.setDecorFitsSystemWindows(false);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            // B 路：栏在内容之外，直接上色
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(canvas);
            window.setNavigationBarColor(canvas);
        }

        applyBarIconContrast(window, paper);
    }

    /** 浅底配深色图标，深底配浅色图标 */
    private void applyBarIconContrast(Window window, boolean paper) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        View decor = window.getDecorView();
        int flags = decor.getSystemUiVisibility();
        flags = paper
                ? (flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR)
                : (flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags = paper
                    ? (flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)
                    : (flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        decor.setSystemUiVisibility(flags);
    }
}
