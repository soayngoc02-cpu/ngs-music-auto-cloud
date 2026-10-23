from pathlib import Path

root = Path('.')
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
print('Patched NewPipe v0.29.1 into YT Gọn.')