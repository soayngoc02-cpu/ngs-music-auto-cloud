package org.ngsmedia.agnesbatch;

import android.content.*;
import android.database.*;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import java.io.*;

/** Read-only provider for files chosen by the user for preview/sharing. */
public final class OutputProvider extends ContentProvider {
    public static Uri uri(Context c,File file){
        try{
            File movies=c.getExternalFilesDir(Environment.DIRECTORY_MOVIES),characters=new File(c.getFilesDir(),"characters");String path=file.getCanonicalPath();
            for(File root:new File[]{movies,characters})if(root!=null&&path.startsWith(root.getCanonicalPath()+File.separator)){
                String relative=path.substring(root.getCanonicalPath().length()+1);
                return new Uri.Builder().scheme("content").authority(c.getPackageName()+".files").appendPath(root==movies?"movies":"characters").appendPath(relative).build();
            }throw new IllegalArgumentException("File nằm ngoài thư mục xuất.");
        }catch(IOException e){throw new IllegalArgumentException(e);}
    }
    private File resolve(Uri uri)throws FileNotFoundException{
        try{
            if(uri.getPathSegments().size()!=2)throw new IOException();
            String type=uri.getPathSegments().get(0);File root;
            if(type.equals("movies"))root=getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES);
            else if(type.equals("characters"))root=new File(getContext().getFilesDir(),"characters");else throw new IOException();
            if(root==null)throw new IOException();File file=new File(root,uri.getPathSegments().get(1)).getCanonicalFile();
            if(!file.getPath().startsWith(root.getCanonicalPath()+File.separator)||!file.isFile())throw new IOException();return file;
        }catch(IOException e){throw new FileNotFoundException("File không tồn tại hoặc không được phép đọc.");}
    }
    @Override public boolean onCreate(){return true;}
    @Override public String getType(Uri uri){return uri.toString().endsWith(".mp4")?"video/mp4":"image/png";}
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{if(!mode.equals("r"))throw new FileNotFoundException("Chỉ được đọc.");return ParcelFileDescriptor.open(resolve(uri),ParcelFileDescriptor.MODE_READ_ONLY);}
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){
        String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;MatrixCursor c=new MatrixCursor(columns);
        try{File f=resolve(uri);Object[] row=new Object[columns.length];for(int i=0;i<columns.length;i++)row[i]=columns[i].equals(OpenableColumns.DISPLAY_NAME)?f.getName():columns[i].equals(OpenableColumns.SIZE)?f.length():null;c.addRow(row);}catch(FileNotFoundException ignored){}return c;
    }
    @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
    @Override public int delete(Uri uri,String selection,String[] args){throw new UnsupportedOperationException();}
    @Override public int update(Uri uri,ContentValues values,String selection,String[] args){throw new UnsupportedOperationException();}
}
