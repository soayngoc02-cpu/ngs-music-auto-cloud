package org.ngsmedia.agnesbatch;

import java.util.*;

/** The merge timeline follows numeric TXT indices, regardless of completion order. */
public final class VideoOrder {
    public static final class Item {
        public final int index;public final String state,path;
        public Item(int index,String state,String path){this.index=index;this.state=state;this.path=path;}
    }
    public static List<Item> timeline(int expected,List<Item> inputs){
        if(expected<1||inputs.size()!=expected)throw new IllegalArgumentException("Danh sách cảnh chưa đủ để ghép.");
        List<Item> ordered=new ArrayList<>(inputs);ordered.sort(Comparator.comparingInt(i->i.index));
        for(int i=0;i<ordered.size();i++){Item item=ordered.get(i);if(item.index!=i+1)throw new IllegalArgumentException("Thứ tự cảnh bị thiếu hoặc trùng.");if(!item.state.equals("DONE")||item.path.isEmpty())throw new IllegalArgumentException("Cảnh "+item.index+" chưa có video hoàn tất.");}
        return Collections.unmodifiableList(ordered);
    }
}
