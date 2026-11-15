// Tube Slide Router - static combo: 3D ASCII + wordmark side by side
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <string.h>
#include <unistd.h>
#include <sys/ioctl.h>

#define PI 3.14159265358979323846f
#define MAX_POINTS 230000
#define MAX_W 220
#define MAX_H 80

typedef struct {float x,y,z;} V;
typedef struct {V p,n; unsigned char part;} P;
static P pts[MAX_POINTS];static int npts=0;
static float depth[MAX_W*MAX_H];static char pix[MAX_W*MAX_H];static unsigned char colors[MAX_W*MAX_H];
static V v(float x,float y,float z){return (V){x,y,z};}
static V add(V a,V b){return v(a.x+b.x,a.y+b.y,a.z+b.z);}
static V sub(V a,V b){return v(a.x-b.x,a.y-b.y,a.z-b.z);}
static V mul(V a,float s){return v(a.x*s,a.y*s,a.z*s);}
static float dot(V a,V b){return a.x*b.x+a.y*b.y+a.z*b.z;}
static V cross(V a,V b){return v(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
static V norm(V a){float d=sqrtf(dot(a,a));return d>1e-6f?mul(a,1.0f/d):v(0,1,0);}
static void emit(V p,V n,int part){if(npts<MAX_POINTS)pts[npts++]=(P){p,norm(n),(unsigned char)part};}
static void cylinder(V a,V b,float radius,int part){
 V axis=norm(sub(b,a));V ref=fabsf(axis.y)<.8f?v(0,1,0):v(1,0,0);
 V u=norm(cross(axis,ref)),w=norm(cross(axis,u));float len=sqrtf(dot(sub(b,a),sub(b,a)));
 int steps=(int)(len*18)+3;if(steps<3)steps=3;
 for(int i=0;i<=steps;i++){float t=i/(float)steps;V c=add(a,mul(sub(b,a),t));
  for(int j=0;j<22;j++){float ang=2*PI*j/22;V radial=add(mul(u,cosf(ang)),mul(w,sinf(ang)));emit(add(c,mul(radial,radius)),radial,part);}}
}
static V center(float t){
 float a=PI*.80f + 2*PI*2.65f*t;
 float r=1.14f + .12f*sinf(t*PI*4);
 float x=r*cosf(a), z=.78f*r*sinf(a);
 float y=3.62f-3.03f*t;
 if(t>.91f){float k=(t-.91f)/.09f;float smooth=k*k*(3-2*k);x+=.8f*smooth;y-=.18f*smooth;z+=.60f*smooth;}
 return v(x,y,z);
}
static void add_tube(){
 const int N=780,R=34;
 for(int i=0;i<=N;i++){
  float t=i/(float)N;V c=center(t);V before=center(fmaxf(0,t-.001f)),after=center(fminf(1,t+.001f));
  V tangent=norm(sub(after,before));V ref=fabsf(tangent.y)<.89f?v(0,1,0):v(1,0,0);
  V u=norm(cross(tangent,ref)),w=norm(cross(tangent,u));
  for(int j=0;j<R;j++){
   float a=2*PI*j/R;
   V radial=add(mul(u,cosf(a)),mul(w,sinf(a)));
   float radius=.31f + .045f*sinf(t*PI);
   emit(add(c,mul(radial,radius)),radial,1);
  }
 }
 for(int k=1;k<15;k++){
  float t=(k+.25f)/16.f;V c=center(t);
  V tangent=norm(sub(center(fminf(1,t+.001f)),center(fmaxf(0,t-.001f))));
  V u=norm(cross(tangent,v(0,1,0))),w=norm(cross(tangent,u));
  if(dot(u,u)<.1f){u=norm(cross(tangent,v(1,0,0)));w=norm(cross(tangent,u));}
  for(int j=0;j<100;j++){float a=2*PI*j/100;V r=add(mul(u,cosf(a)),mul(w,sinf(a)));emit(add(c,mul(r,.36f)),r,2);}
 }
}
static void add_tower(){
 for(int sx=-1;sx<=1;sx+=2)for(int sz=-1;sz<=1;sz+=2)
  cylinder(v(sx*.66f,.12f,sz*.46f),v(sx*.66f,4.12f,sz*.46f),.052f,3);
 for(int i=0;i<2;i++){float z=i?-.55f:.55f;cylinder(v(-.77f,3.73f,z),v(.77f,3.73f,z),.061f,3);}
 for(int i=0;i<2;i++){float x=i?-.77f:.77f;cylinder(v(x,3.73f,-.55f),v(x,3.73f,.55f),.061f,3);}
 cylinder(v(-.72f,3.12f,.55f),v(.72f,3.12f,.55f),.045f,3);
 cylinder(v(-.72f,2.74f,.55f),v(-.72f,3.62f,.55f),.047f,3);
 cylinder(v(.72f,2.74f,.55f),v(.72f,3.62f,.55f),.047f,3);
 for(int i=0;i<=55;i++){float phi=PI*i/55;float x=1.02f*cosf(phi),y=4.13f+.76f*sinf(phi);
  cylinder(v(x,y,-.65f),v(x,y,.65f),.018f,4);}
 for(int j=0;j<=90;j++){float a=2*PI*j/90;float x=1.02f*cosf(a),z=.69f*sinf(a);
  emit(v(x,4.13f,z),v(cosf(a),0,sinf(a)),4);
  for(int i=1;i<=15;i++){float elev=(PI/2)*i/15;float k=cosf(elev);
   V p=v(x*k,4.13f+.77f*sinf(elev),z*k);emit(p,norm(v(x*k,sinf(elev),z*k)),4);}}
 cylinder(v(-1.1f,.12f,-.85f),v(1.1f,.12f,-.85f),.048f,3);
 cylinder(v(-1.1f,.12f,.85f),v(1.1f,.12f,.85f),.048f,3);
}
static V rot(V p,float ay,float ax){
 float c=cosf(ay),s=sinf(ay);p=v(p.x*c+p.z*s,p.y,-p.x*s+p.z*c);
 c=cosf(ax);s=sinf(ax);return v(p.x,p.y*c-p.z*s,p.y*s+p.z*c);
}

#define WM_LINES 6
#define WM_MAXLEN 82
static char wordmark[WM_LINES][WM_MAXLEN+1];
static int wm_len[WM_LINES];
static int wm_loaded=0;

static void load_wordmark(const char*path){
 FILE*f=fopen(path,"r");if(!f)return;
 char buf[512];int line=0;
 while(line<WM_LINES&&fgets(buf,sizeof buf,f)){
  int n=(int)strlen(buf);
  while(n>0&&(buf[n-1]=='\n'||buf[n-1]=='\r'))buf[--n]=0;
  if(n>WM_MAXLEN)n=WM_MAXLEN;
  memcpy(wordmark[line],buf,(size_t)n);wordmark[line][n]=0;
  wm_len[line]=n;
  line++;
 }
 fclose(f);
 wm_loaded=line;
}

int main(int argc,char**argv){
 float angle=0.5f;int no_color=0,slide_w=60,slide_h=34,gap=4;
 const char*wm_path=NULL;
 int use_red=0;
 for(int i=1;i<argc;i++){
  if(!strcmp(argv[i],"--angle")&&i+1<argc)angle=strtof(argv[++i],NULL);
  else if(!strcmp(argv[i],"--slide-width")&&i+1<argc)slide_w=atoi(argv[++i]);
  else if(!strcmp(argv[i],"--slide-height")&&i+1<argc)slide_h=atoi(argv[++i]);
  else if(!strcmp(argv[i],"--gap")&&i+1<argc)gap=atoi(argv[++i]);
  else if(!strcmp(argv[i],"--wordmark")&&i+1<argc)wm_path=argv[++i];
  else if(!strcmp(argv[i],"--no-color"))no_color=1;
  else if(!strcmp(argv[i],"--red"))use_red=1;
  else if(!strcmp(argv[i],"--help")){puts("tube-slide-combo [--wordmark FILE] [--angle N] [--slide-width N] [--slide-height N] [--gap N] [--no-color] [--red]");return 0;}
  else{fprintf(stderr,"Unknown option: %s\n",argv[i]);return 2;}
 }
 if(wm_path)load_wordmark(wm_path);

 if(slide_w<20)slide_w=20;
 if(slide_h<10)slide_h=10;
 if(slide_w>MAX_W)slide_w=MAX_W;
 if(slide_h>MAX_H)slide_h=MAX_H;

 add_tube();add_tower();

 int width=slide_w,height=slide_h;
 if(width>MAX_W)width=MAX_W;if(height>MAX_H)height=MAX_H;
 int total=width*height;
 for(int i=0;i<total;i++){depth[i]=-1e9f;pix[i]=' ';colors[i]=0;}
 const char *ramp=".,-~:;=!*#$@";int maxshade=(int)strlen(ramp)-1;
 V light=norm(v(-.4f,.73f,1.0f));
 for(int i=0;i<npts;i++){
  V p=rot(sub(pts[i].p,v(0,2.40f,0)),angle,.18f),normal=rot(pts[i].n,angle,.18f);
  float dist=8.6f-p.z;if(dist<1)continue;float scale=height*1.35f/dist;
  int x=(int)lrintf(width*.50f+p.x*scale*2.0f);
  int y=(int)lrintf(height*.50f-p.y*scale);
  if(x<0||x>=width||y<0||y>=height)continue;
  int index=y*width+x;
  if(p.z<=depth[index])continue;
  float diff=fmaxf(0,dot(normal,light));V halfv=norm(add(light,v(0,0,1)));
  float spec=powf(fmaxf(0,dot(normal,halfv)),23);
  float intensity=.17f+.68f*diff+.32f*spec;
  if(pts[i].part==2)intensity=fminf(1,intensity+.25f);
  int shade=(int)(intensity*maxshade);if(shade>maxshade)shade=maxshade;
  pix[index]=ramp[shade];depth[index]=p.z;colors[index]=pts[i].part;
 }

 const char*tube_ansi=use_red?"\033[38;5;196m":"\033[38;5;45m";
 const char*seam_ansi=use_red?"\033[38;5;203m":"\033[38;5;51m";
 const int wm_tube_end=23;

 int wm_start_row=(height-wm_loaded)/2;
 if(wm_start_row<0)wm_start_row=0;

 for(int y=0;y<height;y++){
  int prev=-1;
  for(int x=0;x<width;x++){
   int k=y*width+x;int col=colors[k];
   if(!no_color&&col!=prev){
    const char*ansi=col==1?tube_ansi:col==2?seam_ansi:col==3?"\033[38;5;246m":col==4?"\033[38;5;255m":"\033[0m";
    fputs(ansi,stdout);prev=col;
   }
   putchar(pix[k]);
  }
  fputs("\033[0m",stdout);

  if(wm_loaded>0){
   int wm_idx=y-wm_start_row;
   if(wm_idx>=0&&wm_idx<wm_loaded){
    for(int g=0;g<gap;g++)putchar(' ');
    if(!no_color){
     int wlen=wm_len[wm_idx];
     int split=wm_tube_end<wlen?wm_tube_end:wlen;
     fputs(tube_ansi,stdout);
     fwrite(wordmark[wm_idx],1,(size_t)split,stdout);
     if(split<wlen){
      fputs("\033[38;5;255m",stdout);
      fwrite(wordmark[wm_idx]+split,1,(size_t)(wlen-split),stdout);
     }
    } else {
     fputs(wordmark[wm_idx],stdout);
    }
    fputs("\033[0m",stdout);
   }
  }
  putchar('\n');
 }
 printf("\n");
 fflush(stdout);
 return 0;
}
