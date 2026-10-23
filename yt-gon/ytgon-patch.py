from pathlib import Path

root = Path('.')

# Hosted Android runners currently provide stable SDK 36, not preview SDK 37.
config = root / 'buildSrc/src/main/kotlin/ProjectConfig.kt'
project_config = config.read_text()
assert 'NEWPIPE_VERSION_SDK_COMPILE_MAJOR = 37' in project_config
config.write_text(project_config.replace(
    'NEWPIPE_VERSION_SDK_COMPILE_MAJOR = 37',
    'NEWPIPE_VERSION_SDK_COMPILE_MAJOR = 36'))

# The newest AndroidX versions depend on SDK 37. Use last SDK-36-compatible versions.
versions_path = root / 'gradle/libs.versions.toml'
versions = versions_path.read_text()
assert 'core = "1.19.0"' in versions
assert 'lifecycle = "2.11.0"' in versions
versions = versions.replace('core = "1.19.0"', 'core = "1.18.0"')
versions = versions.replace('lifecycle = "2.11.0"', 'lifecycle = "2.10.0"')
versions_path.write_text(versions)
app_build = root / 'app/build.gradle.kts'
s = app_build.read_text()
s = s.replace('applicationId = NEWPIPE_APPLICATION_ID_OLD', 'applicationId = "com.binh.ytgon"')
s = s.replace('resValue("string", "app_name", "NewPipe")', 'resValue("string", "app_name", "YT Gọn")')
s = s.replace('resValue("string", "app_name", "NewPipe Debug")', 'resValue("string", "app_name", "YT Gọn")')
s = s.replace('resValue("string", "app_name", "NewPipe $workingBranch")', 'resValue("string", "app_name", "YT Gọn")')
s = s.replace('applicationIdSuffix = ".debug.$normalizedWorkingBranch"', 'applicationIdSuffix = ""')
s = s.replace('applicationIdSuffix = ".debug"', 'applicationIdSuffix = ""')
assert 'applicationId = "com.binh.ytgon"' in s
app_build.write_text(s)

main_path = root / 'app/src/main/java/org/schabi/newpipe/MainActivity.java'
s = main_path.read_text()
needle = '        Localization.migrateAppLanguageSettingIfNecessary(getApplicationContext());\n'
assert s.count(needle) == 1
prefs = '''        Localization.migrateAppLanguageSettingIfNecessary(getApplicationContext());
        // YT Gon: use device-local search history and show related videos by default.
        final android.content.SharedPreferences ytPrefs =
                PreferenceManager.getDefaultSharedPreferences(this);
        final android.content.SharedPreferences.Editor ytEditor = ytPrefs.edit();
        if (!ytPrefs.contains(getString(R.string.enable_search_history_key))) {
            ytEditor.putBoolean(getString(R.string.enable_search_history_key), true);
        }
        if (!ytPrefs.contains(getString(R.string.show_next_video_key))) {
            ytEditor.putBoolean(getString(R.string.show_next_video_key), true);
        }
        if (!ytPrefs.contains(getString(R.string.stream_info_selected_tab_key))) {
            ytEditor.putString(getString(R.string.stream_info_selected_tab_key), "NEXT VIDEO");
        }
        if (!ytPrefs.contains(getString(R.string.theme_key))) {
            ytEditor.putString(getString(R.string.theme_key),
                    getString(R.string.black_theme_key));
        }
        ytEditor.apply();
'''
s = s.replace(needle, prefs)
initOld = '''        } else {
            NavigationHelper.gotoMainFragment(getSupportFragmentManager());
        }
    }
'''
initNew = '''        } else {
            NavigationHelper.gotoMainFragment(getSupportFragmentManager());
            // Open search on launch; native search suggestions display saved queries.
            NavigationHelper.openSearchFragment(getSupportFragmentManager(), 0, "");
        }
    }
'''
assert s.count(initOld) == 1
s = s.replace(initOld, initNew)
main_path.write_text(s)

# Keep a source-level acknowledgment in the fork.
(root / 'YT_GON_README.md').write_text('''# YT Gọn - GPL-3.0-or-later\n\nYT Gọn is a derivative build of [NewPipe](https://github.com/TeamNewPipe/NewPipe) tag v0.29.1 (GPL-3.0-or-later). The upstream app and extractor authors retain their copyright.\n\nChanges: dedicated YT Gọn app ID, Vietnamese app label, initial search screen, local search history enabled by default, related videos tab initially selected, and dark theme on fresh install. Built from source using GitHub Actions.\n\nTo reproduce, clone upstream tag v0.29.1, run `python3 ytgon-patch.py` from its root, then run `./gradlew :app:assembleDebug -DskipFormatKtlint=true`. The complete corresponding source is the pinned upstream tag combined with this patch script. Redistribution subject to GPL-3.0-or-later. The app is unofficial and is not endorsed by NewPipe or YouTube.\n''')

# v1.1 - replace upstream brightness/volume gestures with fullscreen swipes.
gesture_path = root / 'app/src/main/java/org/schabi/newpipe/player/gesture/MainPlayerGestureListener.kt'
assert 'onScrollVolume' in gesture_path.read_text()
gesture_path.write_text(r'''package org.schabi.newpipe.player.gesture

import android.view.MotionEvent
import android.view.View
import kotlin.math.abs
import org.schabi.newpipe.player.Player
import org.schabi.newpipe.player.ui.MainPlayerUi
import org.schabi.newpipe.util.DeviceUtils

/**
 * YT Gon: vertical player swipes only change fullscreen mode.
 * No gesture ever changes the system volume or screen brightness.
 * Swipe down: fullscreen. Swipe up: normal.
 */
class MainPlayerGestureListener(
    private val playerUi: MainPlayerUi
) : BasePlayerGestureListener(playerUi), View.OnTouchListener {
    private var touchStartX = 0f
    private var touchStartY = 0f
    private var trackingSingleFinger = false

    private val swipeThreshold: Float
        get() = 72f * player.context.resources.displayMetrics.density

    override fun onTouch(v: View, event: MotionEvent): Boolean {
        super.onTouch(v, event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchStartX = event.x
                touchStartY = event.y
                trackingSingleFinger = true
                v.parent?.requestDisallowInterceptTouchEvent(true)
                return true
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                trackingSingleFinger = false
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                return true
            }
            MotionEvent.ACTION_UP -> {
                val dy = event.y - touchStartY
                val dx = event.x - touchStartX
                val awayFromScreenEdges = touchStartY > swipeThreshold / 3f &&
                    touchStartY < v.height - swipeThreshold / 3f
                if (trackingSingleFinger && !isDoubleTapping &&
                    awayFromScreenEdges &&
                    abs(dy) >= swipeThreshold &&
                    abs(dy) > abs(dx) * 1.3f &&
                    player.currentState != Player.STATE_COMPLETED
                ) {
                    applyVerticalSwipe(dy)
                }
                trackingSingleFinger = false
                v.parent?.requestDisallowInterceptTouchEvent(false)
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                trackingSingleFinger = false
                v.parent?.requestDisallowInterceptTouchEvent(false)
                return true
            }
            else -> return true
        }
    }

    private fun applyVerticalSwipe(deltaY: Float) {
        if (deltaY > 0 && !playerUi.isFullscreen) {
            // For ordinary landscape videos on phones, enter landscape fullscreen
            // using the same path as NewPipe's rotation/fullscreen button.
            if (!playerUi.isVerticalVideo && !DeviceUtils.isLandscape(player.context)) {
                player.fragmentListener.ifPresent { it.onScreenRotationButtonClicked() }
            } else {
                playerUi.toggleFullscreen()
            }
        } else if (deltaY < 0 && playerUi.isFullscreen) {
            if (!playerUi.isVerticalVideo && DeviceUtils.isLandscape(player.context)) {
                player.fragmentListener.ifPresent { it.onScreenRotationButtonClicked() }
            } else {
                playerUi.toggleFullscreen()
            }
        }
    }

    override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
        if (isDoubleTapping) return true
        super.onSingleTapConfirmed(e)
        if (player.currentState != Player.STATE_BLOCKED) onSingleTap()
        return true
    }

    // Disable NewPipe's brightness/volume drag gestures completely.
    override fun onScroll(
        initialEvent: MotionEvent?,
        movingEvent: MotionEvent,
        distanceX: Float,
        distanceY: Float
    ): Boolean = false

    override fun getDisplayPortion(e: MotionEvent): DisplayPortion = when {
        e.x < binding.root.width / 3.0 -> DisplayPortion.LEFT
        e.x > binding.root.width * 2.0 / 3.0 -> DisplayPortion.RIGHT
        else -> DisplayPortion.MIDDLE
    }

    override fun getDisplayHalfPortion(e: MotionEvent): DisplayPortion = when {
        e.x < binding.root.width / 2.0 -> DisplayPortion.LEFT_HALF
        else -> DisplayPortion.RIGHT_HALF
    }
}
''')

# Keep the previously installed v1.0 usable in parallel. Each Actions runner
# uses a different debug signing key, so it cannot perform an in-place upgrade.
b = app_build.read_text()
assert 'applicationId = "com.binh.ytgon"' in b
app_build.write_text(b.replace('applicationId = "com.binh.ytgon"',
                               'applicationId = "com.binh.ytgon.v11"'))
config_text = config.read_text()
assert 'NEWPIPE_VERSION_NAME = "0.29.1"' in config_text
assert 'NEWPIPE_VERSION_CODE = 1015' in config_text
config.write_text(config_text.replace('NEWPIPE_VERSION_NAME = "0.29.1"',
                                      'NEWPIPE_VERSION_NAME = "1.1.0"')
                            .replace('NEWPIPE_VERSION_CODE = 1015',
                                     'NEWPIPE_VERSION_CODE = 1016'))

print('Patched NewPipe v0.29.1 into YT Gọn.')