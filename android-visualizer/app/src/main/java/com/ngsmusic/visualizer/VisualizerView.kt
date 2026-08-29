package com.ngsmusic.visualizer

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

class VisualizerView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    var spectrum: SpectrumData? = null; set(value) { field = value; invalidate() }
    var backgroundBitmap: Bitmap? = null; set(value) { field = value; invalidate() }
    var logoBitmap: Bitmap? = null; set(value) { field = value; invalidate() }
    var timeMs: Long = 0L; set(value) { field = value; invalidate() }
    var styleIndex: Int = 0; set(value) { field = value; invalidate() }
    var colorIndex: Int = 0; set(value) { field = value; invalidate() }
    var ratioIndex: Int = 0; set(value) { field = value; invalidate() }
    var intensity: Float = 1f; set(value) { field = value.coerceIn(0.5f, 1.8f); invalidate() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val path = Path(); private val content = RectF()
    init { setLayerType(LAYER_TYPE_SOFTWARE, null) }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas); canvas.drawColor(Color.rgb(5,8,16)); computeContentRect(); canvas.save(); canvas.clipRect(content)
        drawBackground(canvas); drawOverlay(canvas); drawVisualizer(canvas); drawLogo(canvas); canvas.restore()
    }
    private fun computeContentRect() {
        val targetAspect = when(ratioIndex){1->16f/9f;2->1f;else->9f/16f}; val viewAspect=width.toFloat()/max(1,height).toFloat()
        if(viewAspect>targetAspect){val w=height*targetAspect; val l=(width-w)/2f; content.set(l,0f,l+w,height.toFloat())}
        else {val h=width/targetAspect; val t=(height-h)/2f; content.set(0f,t,width.toFloat(),t+h)}
    }
    private fun drawBackground(canvas: Canvas){
        val bg=backgroundBitmap
        if(bg==null){paint.shader=LinearGradient(content.left,content.top,content.right,content.bottom,Color.rgb(19,10,39),Color.rgb(3,18,34),Shader.TileMode.CLAMP);canvas.drawRect(content,paint);paint.shader=null;return}
        canvas.drawBitmap(bg,centerCropSource(bg.width,bg.height,content.width(),content.height()),content,paint)
    }
    private fun drawOverlay(canvas: Canvas){
        paint.shader=LinearGradient(0f,content.top,0f,content.bottom,intArrayOf(Color.argb(50,0,0,0),Color.argb(118,0,0,0),Color.argb(170,0,0,0)),floatArrayOf(0f,.55f,1f),Shader.TileMode.CLAMP);canvas.drawRect(content,paint);paint.shader=null
        paint.shader=RadialGradient(content.centerX(),content.centerY(),max(content.width(),content.height())*.68f,Color.TRANSPARENT,Color.argb(135,0,0,0),Shader.TileMode.CLAMP);canvas.drawRect(content,paint);paint.shader=null
    }
    private fun drawVisualizer(canvas:Canvas){val d=spectrum;val bars=d?.barsAt(timeMs,72)?:demoBars(72);val pulse=d?.pulseAt(timeMs)?:.35f;when(styleIndex){1->drawMirrorBars(canvas,bars);2->drawRadial(canvas,bars,pulse);3->drawLineWave(canvas,bars);4->drawBassHalo(canvas,bars,pulse);else->drawNeonBars(canvas,bars)}}
    private fun drawNeonBars(canvas:Canvas,bars:FloatArray){val p=palette();val base=content.top+content.height()*.71f;val total=content.width()*.82f;val x0=content.centerX()-total/2f;val gap=total/bars.size*.34f;val bw=total/bars.size-gap;val mh=content.height()*.24f*intensity;paint.shader=LinearGradient(0f,base-mh,0f,base,p.first,p.second,Shader.TileMode.CLAMP);paint.strokeCap=Paint.Cap.ROUND;for(i in bars.indices){val h=max(3f,mh*bars[i]);val l=x0+i*(bw+gap);paint.setShadowLayer(max(4f,bw*1.6f),0f,0f,p.first);canvas.drawRoundRect(l,base-h,l+bw,base,bw,bw,paint)};paint.clearShadowLayer();paint.shader=null}
    private fun drawMirrorBars(canvas:Canvas,bars:FloatArray){val p=palette();val mid=content.top+content.height()*.66f;val total=content.width()*.84f;val x0=content.centerX()-total/2f;val slot=total/bars.size;val bw=slot*.55f;val mh=content.height()*.17f*intensity;paint.shader=LinearGradient(0f,mid-mh,0f,mid+mh,p.first,p.second,Shader.TileMode.CLAMP);for(i in bars.indices){val h=mh*bars[i];val x=x0+i*slot+(slot-bw)/2f;paint.setShadowLayer(max(4f,bw*1.6f),0f,0f,p.first);canvas.drawRoundRect(x,mid-h,x+bw,mid+h,bw,bw,paint)};paint.clearShadowLayer();paint.shader=null;paint.color=Color.argb(110,255,255,255);paint.strokeWidth=max(1f,content.width()*.0022f);canvas.drawLine(x0,mid,x0+total,mid,paint)}
    private fun drawRadial(canvas:Canvas,bars:FloatArray,pulse:Float){val p=palette();val cx=content.centerX();val cy=content.top+content.height()*.49f;val r=min(content.width(),content.height())*(.16f+pulse*.012f);val ml=min(content.width(),content.height())*.12f*intensity;paint.strokeWidth=max(2f,min(content.width(),content.height())*.008f);paint.strokeCap=Paint.Cap.ROUND;paint.shader=SweepGradient(cx,cy,intArrayOf(p.first,p.second,p.first),null);paint.setShadowLayer(paint.strokeWidth*2,0f,0f,p.first);for(i in bars.indices){val a=2.0*PI*i/bars.size-PI/2;val r2=r+ml*bars[i];canvas.drawLine(cx+cos(a).toFloat()*r,cy+sin(a).toFloat()*r,cx+cos(a).toFloat()*r2,cy+sin(a).toFloat()*r2,paint)};paint.clearShadowLayer();paint.shader=null}
    private fun drawLineWave(canvas:Canvas,bars:FloatArray){val p=palette();val base=content.top+content.height()*.68f;val total=content.width()*.84f;val x0=content.centerX()-total/2f;val amp=content.height()*.17f*intensity;path.reset();for(i in bars.indices){val x=x0+i*total/(bars.size-1).coerceAtLeast(1);val y=base+(if(i%2==0)-1f else 1f)*amp*bars[i]*.58f;if(i==0)path.moveTo(x,y)else path.lineTo(x,y)};paint.style=Paint.Style.STROKE;paint.strokeCap=Paint.Cap.ROUND;paint.strokeJoin=Paint.Join.ROUND;paint.strokeWidth=max(3f,content.width()*.008f);paint.shader=LinearGradient(x0,0f,x0+total,0f,p.first,p.second,Shader.TileMode.CLAMP);paint.setShadowLayer(paint.strokeWidth*2.8f,0f,0f,p.first);canvas.drawPath(path,paint);paint.clearShadowLayer();paint.shader=null;paint.style=Paint.Style.FILL}
    private fun drawBassHalo(canvas:Canvas,bars:FloatArray,pulse:Float){val p=palette();val cx=content.centerX();val cy=content.top+content.height()*.5f;val ms=min(content.width(),content.height());val r=ms*(.18f+pulse*.055f);paint.style=Paint.Style.STROKE;paint.strokeWidth=max(3f,ms*.009f);paint.color=p.first;paint.setShadowLayer(paint.strokeWidth*3,0f,0f,p.first);canvas.drawCircle(cx,cy,r,paint);paint.strokeWidth*=.45f;paint.color=p.second;canvas.drawCircle(cx,cy,r*1.10f,paint);paint.clearShadowLayer();paint.style=Paint.Style.FILL;drawRadial(canvas,FloatArray(36){bars[it*2%bars.size]},pulse*.25f)}
    private fun drawLogo(canvas:Canvas){val logo=logoBitmap?:return;val pulse=spectrum?.pulseAt(timeMs)?:0f;val cy=if(styleIndex in listOf(0,1,3))content.top+content.height()*.47f else content.top+content.height()*.49f;val ms=min(content.width(),content.height())*(.22f+pulse*.015f);val a=logo.width.toFloat()/max(1,logo.height);val w:Float;val h:Float;if(a>=1f){w=ms;h=ms/a}else{h=ms;w=ms*a};val d=RectF(content.centerX()-w/2,cy-h/2,content.centerX()+w/2,cy+h/2);paint.setShadowLayer(ms*.08f,0f,0f,Color.argb(190,255,255,255));canvas.drawBitmap(logo,null,d,paint);paint.clearShadowLayer()}
    private fun palette():Pair<Int,Int> = when(colorIndex){1->Color.rgb(255,76,122) to Color.rgb(255,190,74);2->Color.rgb(68,221,255) to Color.rgb(88,120,255);3->Color.rgb(255,211,78) to Color.rgb(255,118,39);4->Color.rgb(245,245,255) to Color.rgb(150,160,180);else->Color.rgb(178,73,255) to Color.rgb(39,227,255)}
    private fun centerCropSource(bw:Int,bh:Int,dw:Float,dh:Float):Rect{val ba=bw.toFloat()/max(1,bh);val da=dw/max(1f,dh);return if(ba>da){val ww=(bh*da).toInt().coerceAtLeast(1);val l=(bw-ww)/2;Rect(l,0,l+ww,bh)}else{val hh=(bw/da).toInt().coerceAtLeast(1);val t=(bh-hh)/2;Rect(0,t,bw,t+hh)}}
    private fun demoBars(count:Int):FloatArray{val t=System.nanoTime()/1_000_000_000.0;return FloatArray(count){i->((sin(t*3.2+i*.33)+sin(t*1.7+i*.11)*.55+1.7)/3.25).toFloat().coerceIn(.08f,.9f)}}
}
