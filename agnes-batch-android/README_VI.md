# Agnes Batch Android V1

**Tình trạng:** V1 đã build thành APK, vượt qua Android lint (không có lỗi), kiểm tra chữ ký/package/launcher và 60 kiểm tra lõi với API giả lập. Chưa kiểm thử trên thiết bị Android hoặc bằng API key Agnes thật. Đây là bản debug để thử V1.

[Build đã xác minh](https://github.com/soayngoc02-cpu/ngs-music-auto-cloud/actions/runs/35184449621). Tải artifact `AgnesBatchAndroid-APK`, giải nén và cài `AgnesBatchAndroid.apk` (khoảng 11 MB).

Hỗ trợ **Android 10 trở lên**, giao diện tiếng Việt, ứng dụng native Java. Agnes tạo video trên server; điện thoại gửi yêu cầu, nhận video, lưu và ghép.

## Tính năng đã viết

- Nhập TXT tối đa 50 prompt; mỗi prompt 1–2 dòng, ngăn cách bằng dòng trắng.
- Đọc UTF-8, UTF-8 BOM và UTF-16 có BOM.
- Ưu tiên số giây đầu prompt; nếu không có thì lấy mặc định đang chọn.
- Chọn 9:16, 16:9, 1:1, 4:3, 3:4 hoặc 21:9.
- Model `agnes-video-2.5-flash` (720P) hoặc `agnes-video-2.5` (720P/1080P/2K).
- Hàng đợi 1–3 cảnh đồng thời, theo dõi trạng thái và tiến độ từng cảnh.
- Nhập API key đơn lẻ hoặc từ TXT, bỏ key trùng, bật/tắt, sửa và xóa key.
- Mã hóa key bằng AES-GCM với Android Keystore; không lưu key trong JSON tiến độ.
- Chia job mới giữa các key đang bật; giữ đúng key và ID khi kiểm tra job đã tạo.
- Lưu cảnh hoàn tất vào bộ nhớ app và `Movies/AgnesBatch` bằng MediaStore.
- Tự ghép đủ cảnh theo thứ tự TXT; giữ các file riêng, tạo `merged.mp4`.
- Ghép bằng Media3, xuất MP4/H.264, chuẩn hóa tỷ lệ và frame rate 24 fps. Nếu cần thay tỷ lệ, ảnh được cắt giữa để đầy khung.
- Chạy lại từng cảnh lỗi hoặc các cảnh lỗi; tải/kiểm tra tiếp job cũ khi có ID.
- Tạm dừng và tiếp tục; lưu lịch sử từng lượt chạy, chọn lại lượt cũ.
- Tạo ảnh character sheet qua Agnes, lưu ảnh và mô tả; dùng `@A`, `@B` trong prompt để gửi ảnh tham chiếu thật.
- Video từ ảnh: dán URL ảnh hoặc chọn ảnh trên điện thoại và tải lên Cloudinary đã cấu hình.
- Mặc định loại âm thanh khỏi các cảnh đã lưu và bản ghép, kèm yêu cầu không thoại/lip-sync trong prompt. Có thể tắt trong Cài đặt.
- Mở và chia sẻ video tổng từ app.

## Tạo APK trên Windows

1. Cài Android Studio, mở SDK Manager và cài **Android SDK Platform 35** cùng **Build Tools 35.0.0**.
2. Giải nén gói vào một thư mục.
3. Bấm `BUILD_APK_WINDOWS.cmd`. Script dùng JDK đi kèm Android Studio hoặc `JAVA_HOME`, tải Gradle 8.9 chính thức, kiểm tra SHA-256, tạo wrapper và chạy `lintDebug assembleDebug`.
4. Nếu thành công, file **AgnesBatchAndroid.apk** xuất hiện ở thư mục gốc. Chép APK sang điện thoại và cài.

Script chỉ thông báo đã tạo APK sau khi build thành công; lỗi build sẽ dừng và giữ thông báo lỗi. Lần đầu cần Internet để tải Gradle và các dependency. Đây là APK debug để thử V1; bản phát hành cần ký với keystore riêng.

Có thể mở cả thư mục bằng Android Studio. Sau khi script tạo wrapper, chọn Gradle JDK phù hợp với Android Gradle Plugin 8.7.3, rồi Sync/Build.

## Tạo APK bằng GitHub Actions

Trong repo `soayngoc02-cpu/ngs-music-auto-cloud`, mã nguồn nằm ở `agnes-batch-android/`, workflow ở `.github/workflows/agnes-android-apk.yml` trên nhánh `build-agnes-apk`. Vào Actions → Build Android APK → Run workflow và chọn nhánh này. Khi build thành công, tải artifact `AgnesBatchAndroid-APK`, giải nén và cài `AgnesBatchAndroid.apk`.

Nếu dùng repo khác, đưa **nội dung thư mục dự án này** vào repo, bao gồm `.github/workflows/android-apk.yml`. Workflow bên trong dự án dùng đường dẫn tương đối từ gốc repo.

Workflow kiểm tra chữ ký bằng `apksigner`, kiểm tra package/launcher/Android tối thiểu bằng `aapt2`, kiểm tra cấu trúc ZIP và tạo SHA-256. Artifact kèm các báo cáo `APK_SIGNATURE.txt`, `APK_PACKAGE.txt`, `APK_MANIFEST.xml`, `APK_SHA256.txt`. `apkanalyzer` giải mã manifest để đối chiếu chính xác SDK và launcher. Chỉ tải lên artifact nếu các bước xác minh thành công. Đây là APK debug để thử V1.

Workflow đã chạy thành công và file tải về đã được đối chiếu SHA-256. Không đưa API key thật vào repository; nhập key trong app sau khi cài.

## Cách dùng

1. Vào **API key**, thêm key Agnes của bạn.
2. Nếu cần nhân vật nhất quán, vào **Nhân vật** tạo sheet `A`, `B`… mô tả rõ tên, tuổi, mặt, tóc và quần áo. Có thể dùng URL sheet có sẵn.
3. Vào **Video**, chọn tỷ lệ và số giây mặc định, nhập TXT.
4. Nếu cần tạo video từ ảnh, bấm **Gắn / đổi ảnh cảnh** ở từng cảnh, dán URL hoặc chọn ảnh.
5. Bấm **Chạy / tiếp tục**. App nhận video, tự lưu và tự ghép khi đủ tất cả cảnh nếu bật tùy chọn.
6. Cảnh lỗi: đọc lỗi, sửa key/cấu hình ảnh nếu cần, bấm **Chạy lại**. Xem video tổng trong app hoặc `Movies/AgnesBatch`.

Cấu hình video có thể đổi khi lượt vẫn hoàn toàn chờ chạy. Sau khi bắt đầu, lượt giữ model, tỷ lệ, thời lượng mặc định, cấu hình âm thanh và ảnh tham chiếu của riêng nó để các cảnh không bị lệch nhau. Cấu hình Cloudinary được đọc lại khi tải ảnh, nên có thể sửa rồi chạy lại cảnh lỗi upload.

## Định dạng TXT

```text
001 | 4s | @A đứng bên cửa căn nhà lá.
Máy quay đứng yên, miệng khép, không thoại.

6 giây: Ngọn đèn dầu trên bàn gỗ lay nhẹ.

Chiếc xuồng trôi dọc con kinh.
```

Cảnh 1 dùng 4 giây, cảnh 2 dùng 6 giây, cảnh 3 dùng mặc định trên tool. Số `001` là số cảnh, không phải thời lượng. Thứ tự ghép dựa trên vị trí prompt trong TXT, không phụ thuộc số thứ tự bạn ghi hoặc thứ tự tạo xong.

Cũng nhận `4s`, `[4s]`, `4 giây`, `4 | ...`, `4: ...` và `4 ...` ở đầu prompt. Nên dùng `4s | ...` để rõ ràng. Một prompt chứa hơn 2 dòng hoặc một lượt chứa hơn 50 prompt sẽ bị từ chối trước khi tạo job.

**Giới hạn model:** Agnes 2.5/2.5 Flash nhận số giây nguyên từ **4 đến 12**. Thời lượng ngoài khoảng này bị báo lỗi, không được đổi ngầm. App gửi đúng tham số `seconds`; nếu file thực tế Agnes trả khác yêu cầu hơn 0,15 giây, cảnh sẽ có cảnh báo. V1 không kéo dài video bằng cách lặp hoặc giữ hình.

**TXT key:** mỗi dòng một key, dòng trắng bỏ qua, dòng bắt đầu `#` là ghi chú. Thư mục samples có ví dụ định dạng, không có key dùng thật.

## Character sheet và ảnh cảnh

Ví dụ tạo `A` tên Tuấn, 35 tuổi, tóc ngắn, áo bà ba nâu; tạo `B` tên Thầy Hai, 63 tuổi, tóc bạc, áo bà ba đen. Trong TXT dùng `@A` và `@B`. App chuyển các ký hiệu thành tên và `<Picture N>`, gửi đúng URL sheet trong mảng `images`. Không chỉ chèn mô tả bằng chữ.

- Không có ảnh và không có nhân vật: `mode: text`.
- Có ảnh cảnh, không có sheet trong prompt: `mode: keyframe`, gửi `first_frame`.
- Có sheet: `mode: reference`, gửi các sheet. Nếu có thêm ảnh cảnh, ảnh cảnh là `<Picture 1>`, các sheet đi tiếp theo.
- Không trộn `first_frame` với `images` vì API không cho phép. Trong chế độ reference, ảnh cảnh là ảnh định hướng bố cục, không có bảo đảm khung hình đầu giống từng pixel.
- Tối đa 5 ảnh tham chiếu/cảnh trong V1, tính cả ảnh cảnh. Cảnh chỉ gửi nhân vật có ký hiệu trong prompt.
- Mỗi lượt giữ bản sao mô tả và URL sheet khi nhập TXT. Chỉnh nhân vật cho lượt mới không đổi danh tính của lượt đang chạy.

Nhất quán nhân vật còn phụ thuộc model Agnes; app cung cấp ảnh tham chiếu và khóa mô tả, không bảo đảm mọi cảnh giống tuyệt đối.

## Ảnh trên điện thoại

Agnes Video yêu cầu ảnh ở URL công khai và tồn tại đến khi job hoàn tất. V1 không tự gửi file cục bộ hoặc Data URI vào endpoint video.

Trong Cloudinary, tạo **unsigned upload preset** cho ảnh, rồi điền **cloud name** và **preset** vào Cài đặt. App gửi ảnh đến endpoint upload Cloudinary và dùng `secure_url` trả về. Không cần API secret Cloudinary. Ảnh chọn trên máy được xử lý hướng EXIF, thu gọn cạnh dài tối đa khoảng 2048 px và lưu JPEG trước khi upload. Nếu không muốn cấu hình upload, dán URL HTTPS ảnh đã có.

Các ảnh tải lên được lưu trên tài khoản Cloudinary của bạn; V1 không tự xóa chúng vì các job đang chạy vẫn có thể cần URL. Key Agnes không được gửi đến Cloudinary hoặc host tải video.

## Khôi phục và lỗi

- Khi có `video_id`, Chạy lại tiếp tục kiểm tra/tải kết quả bằng ID và key cũ.
- Khi Agnes báo job thất bại, Chạy lại tạo job mới cho riêng cảnh đó.
- Lỗi 429 khi kiểm tra job được chờ theo backoff/Retry-After. Lỗi 429 khi tạo job dừng cảnh và cho chạy lại; không gửi thêm yêu cầu dồn dập.
- Mất kết nối hoặc lỗi server trong lúc gửi nhưng chưa nhận ID: đánh dấu **Cần kiểm tra job**. Không tự gửi lại vì có thể tạo trùng video.
- Nếu tìm thấy ID trên Agnes, dùng **Gắn ID job**, gán đúng key rồi Chạy lại. Nếu đã xác minh job không tồn tại, xác nhận tạo lại riêng cảnh.
- Khi Android dừng app hoặc dịch vụ nền hết thời gian, mở app và bấm Tiếp tục. Job phía Agnes không bị hủy bởi nút Tạm dừng.
- API lỗi/billing/hết quyền sẽ được hiển thị tại cảnh; app không tự làm key hết quota hoạt động được.

## Kiểm tra đã chạy

Chạy `python3 tools/test_core.py` trên máy có Java 17 và Python 3. Bộ kiểm tra dùng server HTTP cục bộ giả lập Agnes, không tạo video thật hoặc sử dụng key thật.

Đã vượt qua **60 kiểm tra**: đọc TXT và encoding, thời lượng, giới hạn batch, key trùng, JSON, phục hồi job, đúng cấu trúc request/polling, che key trong lỗi, không gửi key sang host media, ánh xạ ảnh sheet và thứ tự 50 cảnh hoàn thành ngược. Đã dùng Java compiler parse cú pháp toàn bộ 13 file Java của app.

**Đã kiểm tra Android:** `lintDebug assembleDebug`, chữ ký APK v2 bằng `apksigner`, package/manifest/launcher, cấu trúc ZIP và SHA-256 sau khi tải. Android lint không có lỗi; vẫn có cảnh báo về nâng phiên bản thư viện, đa ngôn ngữ và khuyến nghị nền tảng.

**Chưa kiểm tra:** giao diện trên thiết bị, Android Keystore trên máy thật, MediaStore, codec/ghép Media3, Cloudinary thật và gọi Agnes bằng key thật. Kiểm tra lõi không thay thế việc cài và chạy thử APK.

## Nguồn API

- [Agnes Video 2.5 Flash](https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash)
- [Agnes Video 2.5](https://wiki.agnes-ai.com/en/docs/agnes-video-25)
- [Agnes Image 2.5 Flash](https://wiki.agnes-ai.com/en/docs/agnes-image-25-flash)
- [Media3 Transformer](https://developer.android.com/media/media3/transformer/multi-asset)
- [Giới hạn dịch vụ nền Android](https://developer.android.com/develop/background-work/services/fgs/timeout)
- [Cloudinary Upload API](https://cloudinary.com/documentation/image_upload_api_reference)

Thông số API đối chiếu ngày 17/09/2026. Nếu bạn dùng một nhà cung cấp mang tên Agnes Studio nhưng API khác cổng `apihub.agnes-ai.com`, cần đối chiếu tài liệu của nhà cung cấp đó trước khi dùng.
