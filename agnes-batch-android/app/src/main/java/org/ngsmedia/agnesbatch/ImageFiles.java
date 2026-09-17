package org.ngsmedia.agnesbatch;

import android.content.*;
import android.graphics.*;
import android.media.ExifInterface;
import android.net.Uri;
import java.io.*;

final class ImageFiles {
    private ImageFiles(){}
    static void copyFrame(Context c,Uri uri,File output)throws IOException{
        File raw=new File(output.getParentFile(),output.getName()+".source");Bitmap decoded=null,rotated=null,flat=null;
        try{
            try(InputStream in=c.getContentResolver().openInputStream(uri);OutputStream out=new FileOutputStream(raw)){
                if(in==null)throw new IOException("Không mở được ảnh.");byte[] bytes=new byte[65536];long total=0;int n;
                while((n=in.read(bytes))>=0){total+=n;if(total>20L*1024*1024)throw new IOException("Ảnh tối đa 20 MB.");out.write(bytes,0,n);}
            }
            BitmapFactory.Options opts=new BitmapFactory.Options();opts.inJustDecodeBounds=true;BitmapFactory.decodeFile(raw.getAbsolutePath(),opts);
            if(opts.outWidth<1||opts.outHeight<1)throw new IOException("Định dạng ảnh không đọc được.");
            opts.inSampleSize=1;while(Math.max(opts.outWidth,opts.outHeight)/opts.inSampleSize>2048)opts.inSampleSize*=2;
            opts.inJustDecodeBounds=false;decoded=BitmapFactory.decodeFile(raw.getAbsolutePath(),opts);if(decoded==null)throw new IOException("Không đọc được ảnh.");
            int orientation=ExifInterface.ORIENTATION_NORMAL;try{orientation=new ExifInterface(raw.getAbsolutePath()).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);}catch(IOException ignored){}
            Matrix transform=new Matrix();switch(orientation){
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:transform.setScale(-1,1);break;
                case ExifInterface.ORIENTATION_ROTATE_180:transform.setRotate(180);break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL:transform.setScale(1,-1);break;
                case ExifInterface.ORIENTATION_TRANSPOSE:transform.setRotate(90);transform.postScale(-1,1);break;
                case ExifInterface.ORIENTATION_ROTATE_90:transform.setRotate(90);break;
                case ExifInterface.ORIENTATION_TRANSVERSE:transform.setRotate(-90);transform.postScale(-1,1);break;
                case ExifInterface.ORIENTATION_ROTATE_270:transform.setRotate(-90);break;
            }
            rotated=Bitmap.createBitmap(decoded,0,0,decoded.getWidth(),decoded.getHeight(),transform,true);
            flat=Bitmap.createBitmap(rotated.getWidth(),rotated.getHeight(),Bitmap.Config.RGB_565);Canvas canvas=new Canvas(flat);canvas.drawColor(Color.WHITE);canvas.drawBitmap(rotated,0,0,null);
            try(OutputStream out=new FileOutputStream(output)){if(!flat.compress(Bitmap.CompressFormat.JPEG,92,out))throw new IOException("Không lưu được ảnh.");}
        }catch(OutOfMemoryError e){throw new IOException("Ảnh quá lớn so với bộ nhớ điện thoại.",e);}finally{raw.delete();if(flat!=null)flat.recycle();if(rotated!=null&&rotated!=decoded)rotated.recycle();if(decoded!=null)decoded.recycle();}
    }
}
