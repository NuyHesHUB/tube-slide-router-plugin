// Tube Slide Router — portable single-file 3D ASCII renderer
// Compile: cc -O2 -Wall -std=c11 -o tube-slide-portable tube_slide_portable.c -lm
// Usage:   ./tube-slide-portable [--combo] [--blue] [--angle N] [--slide-width N] [--slide-height N] [--vgap N] [--gap N] [--no-color]
// Default: red stacked layout with embedded wordmark
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
static V vadd(V a,V b){return v(a.x+b.x,a.y+b.y,a.z+b.z);}
static V vsub(V a,V b){return v(a.x-b.x,a.y-b.y,a.z-b.z);}
static V vmul(V a,float s){return v(a.x*s,a.y*s,a.z*s);}
static float vdot(V a,V b){return a.x*b.x+a.y*b.y+a.z*b.z;}
static V vcross(V a,V b){return v(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
static V vnorm(V a){float d=sqrtf(vdot(a,a));return d>1e-6f?vmul(a,1.0f/d):v(0,1,0);}
static void emit(V p,V n,int part){if(npts<MAX_POINTS)pts[npts++]=(P){p,vnorm(n),(unsigned char)part};}

static void cylinder(V a,V b,float radius,int part){
 V axis=vnorm(vsub(b,a));V ref=fabsf(axis.y)<.8f?v(0,1,0):v(1,0,0);
 V u=vnorm(vcross(axis,ref)),w=vnorm(vcross(axis,u));float len=sqrtf(vdot(vsub(b,a),vsub(b,a)));
 int steps=(int)(len*18)+3;if(steps<3)steps=3;
 for(int i=0;i<=steps;i++){float t=i/(float)steps;V c=vadd(a,vmul(vsub(b,a),t));
  for(int j=0;j<22;j++){float ang=2*PI*j/22;V radial=vadd(vmul(u,cosf(ang)),vmul(w,sinf(ang)));emit(vadd(c,vmul(radial,radius)),radial,part);}}
}

static V center(float t){
 float a=PI*.80f + 2*PI*2.65f*t;
 float r=1.14f + .12f*sinf(t*PI*4);
 float x=r*cosf(a), z=.78f*r*sinf(a);
 float y=3.62f-3.03f*t;
 if(t>.91f){float k=(t-.91f)/.09f;float smooth=k*k*(3-2*k);x+=.8f*smooth;y-=.18f*smooth;z+=.60f*smooth;}
 return v(x,y,z);
}

static void add_tube(void){
 const int N=780,R=34;
 for(int i=0;i<=N;i++){
  float t=i/(float)N;V c=center(t);V before=center(fmaxf(0,t-.001f)),after=center(fminf(1,t+.001f));
  V tangent=vnorm(vsub(after,before));V ref=fabsf(tangent.y)<.89f?v(0,1,0):v(1,0,0);
  V u=vnorm(vcross(tangent,ref)),w=vnorm(vcross(tangent,u));
  for(int j=0;j<R;j++){
   float a=2*PI*j/R;
   V radial=vadd(vmul(u,cosf(a)),vmul(w,sinf(a)));
   float radius=.31f + .045f*sinf(t*PI);
   emit(vadd(c,vmul(radial,radius)),radial,1);
  }
 }
 for(int k=1;k<15;k++){
  float t=(k+.25f)/16.f;V c=center(t);
  V tangent=vnorm(vsub(center(fminf(1,t+.001f)),center(fmaxf(0,t-.001f))));
  V u=vnorm(vcross(tangent,v(0,1,0))),w=vnorm(vcross(tangent,u));
  if(vdot(u,u)<.1f){u=vnorm(vcross(tangent,v(1,0,0)));w=vnorm(vcross(tangent,u));}
  for(int j=0;j<100;j++){float a=2*PI*j/100;V r=vadd(vmul(u,cosf(a)),vmul(w,sinf(a)));emit(vadd(c,vmul(r,.36f)),r,2);}
 }
}

static void add_tower(void){
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
   V p=v(x*k,4.13f+.77f*sinf(elev),z*k);emit(p,vnorm(v(x*k,sinf(elev),z*k)),4);}}
 cylinder(v(-1.1f,.12f,-.85f),v(1.1f,.12f,-.85f),.048f,3);
 cylinder(v(-1.1f,.12f,.85f),v(1.1f,.12f,.85f),.048f,3);
}

static V rot(V p,float ay,float ax){
 float c=cosf(ay),s=sinf(ay);p=v(p.x*c+p.z*s,p.y,-p.x*s+p.z*c);
 c=cosf(ax);s=sinf(ax);return v(p.x,p.y*c-p.z*s,p.y*s+p.z*c);
}

#define WM_LINES 6
static const char *embedded_wm[WM_LINES]={
 " _______    _             _____ _ _     _        _____             _            ",
 "|__   __|  | |           / ____| (_)   | |      |  __ \\           | |           ",
 "   | |_   _| |__   ___  | (___ | |_  __| | ___  | |__) |___  _   _| |_ ___ _ __ ",
 "   | | | | | '_ \\ / _ \\  \\___ \\| | |/ _` |/ _ \\ |  _  // _ \\| | | | __/ _ \\ '__|",
 "   | | |_| | |_) |  __/  ____) | | | (_| |  __/ | | \\ \\ (_) | |_| | ||  __/ |   ",
 "   |_|\\__,_|_.__/ \\___| |_____/|_|_|\\__,_|\\___| |_|  \\_\\___/ \\__,_|\\__\\___|_|",
};

static int get_term_width(void){
 if(!isatty(STDOUT_FILENO))return 120;
 struct winsize ws;
 if(ioctl(STDOUT_FILENO,TIOCGWINSZ,&ws)==0&&ws.ws_col>0)return ws.ws_col;
 return 120;
}

static void render_3d(int width,int height,float angle){
 if(width>MAX_W)width=MAX_W;
 if(height>MAX_H)height=MAX_H;
 int total=width*height;
 for(int i=0;i<total;i++){depth[i]=-1e9f;pix[i]=' ';colors[i]=0;}
 const char *ramp=".,-~:;=!*#$@";int maxshade=(int)strlen(ramp)-1;
 V light=vnorm(v(-.4f,.73f,1.0f));
 for(int i=0;i<npts;i++){
  V p=rot(vsub(pts[i].p,v(0,2.40f,0)),angle,.18f),normal=rot(pts[i].n,angle,.18f);
  float dist=8.6f-p.z;if(dist<1)continue;float scale=height*1.35f/dist;
  int x=(int)lrintf(width*.50f+p.x*scale*2.0f);
  int y=(int)lrintf(height*.50f-p.y*scale);
  if(x<0||x>=width||y<0||y>=height)continue;
  int index=y*width+x;
  if(p.z<=depth[index])continue;
  float diff=fmaxf(0,vdot(normal,light));V halfv=vnorm(vadd(light,v(0,0,1)));
  float spec=powf(fmaxf(0,vdot(normal,halfv)),23);
  float intensity=.17f+.68f*diff+.32f*spec;
  if(pts[i].part==2)intensity=fminf(1,intensity+.25f);
  int shade=(int)(intensity*maxshade);if(shade>maxshade)shade=maxshade;
  pix[index]=ramp[shade];depth[index]=p.z;colors[index]=pts[i].part;
 }
}

static void output_stack(int width,int height,int vgap,int use_color,int use_red){
 const char*tube_ansi=use_red?"\033[38;5;196m":"\033[38;5;45m";
 const char*seam_ansi=use_red?"\033[38;5;203m":"\033[38;5;51m";
 int term_w=get_term_width();
 int slide_pad=(term_w-width)/2;if(slide_pad<0)slide_pad=0;

 for(int y=0;y<height;y++){
  for(int sp=0;sp<slide_pad;sp++)putchar(' ');
  int prev=-1;
  for(int x=0;x<width;x++){
   int k=y*width+x;int col=colors[k];
   if(use_color&&col!=prev){
    const char*ansi=col==1?tube_ansi:col==2?seam_ansi:col==3?"\033[38;5;246m":col==4?"\033[38;5;255m":"\033[0m";
    fputs(ansi,stdout);prev=col;
   }
   putchar(pix[k]);
  }
  fputs("\033[0m\n",stdout);
 }
 for(int g=0;g<vgap;g++)putchar('\n');

 int wm_maxwidth=0;
 for(int i=0;i<WM_LINES;i++){int n=(int)strlen(embedded_wm[i]);if(n>wm_maxwidth)wm_maxwidth=n;}
 int wm_pad=(term_w-wm_maxwidth)/2;if(wm_pad<0)wm_pad=0;
 const int wm_tube_end=23;

 for(int i=0;i<WM_LINES;i++){
  for(int sp=0;sp<wm_pad;sp++)putchar(' ');
  int wlen=(int)strlen(embedded_wm[i]);
  if(use_color){
   int split=wm_tube_end<wlen?wm_tube_end:wlen;
   fputs(tube_ansi,stdout);
   fwrite(embedded_wm[i],1,(size_t)split,stdout);
   if(split<wlen){
    fputs("\033[38;5;255m",stdout);
    fwrite(embedded_wm[i]+split,1,(size_t)(wlen-split),stdout);
   }
  } else {
   fputs(embedded_wm[i],stdout);
  }
  fputs("\033[0m\n",stdout);
 }
 printf("\n");fflush(stdout);
}

static void output_combo(int width,int height,int gap,int use_color,int use_red){
 const char*tube_ansi=use_red?"\033[38;5;196m":"\033[38;5;45m";
 const char*seam_ansi=use_red?"\033[38;5;203m":"\033[38;5;51m";
 const int wm_tube_end=23;
 int wm_start_row=(height-WM_LINES)/2;if(wm_start_row<0)wm_start_row=0;

 for(int y=0;y<height;y++){
  int prev=-1;
  for(int x=0;x<width;x++){
   int k=y*width+x;int col=colors[k];
   if(use_color&&col!=prev){
    const char*ansi=col==1?tube_ansi:col==2?seam_ansi:col==3?"\033[38;5;246m":col==4?"\033[38;5;255m":"\033[0m";
    fputs(ansi,stdout);prev=col;
   }
   putchar(pix[k]);
  }
  fputs("\033[0m",stdout);

  int wm_idx=y-wm_start_row;
  if(wm_idx>=0&&wm_idx<WM_LINES){
   for(int g=0;g<gap;g++)putchar(' ');
   int wlen=(int)strlen(embedded_wm[wm_idx]);
   if(use_color){
    int split=wm_tube_end<wlen?wm_tube_end:wlen;
    fputs(tube_ansi,stdout);
    fwrite(embedded_wm[wm_idx],1,(size_t)split,stdout);
    if(split<wlen){
     fputs("\033[38;5;255m",stdout);
     fwrite(embedded_wm[wm_idx]+split,1,(size_t)(wlen-split),stdout);
    }
   } else {
    fputs(embedded_wm[wm_idx],stdout);
   }
   fputs("\033[0m",stdout);
  }
  putchar('\n');
 }
 printf("\n");fflush(stdout);
}

int main(int argc,char**argv){
 float angle=1.0f;int no_color=0,slide_w=80,slide_h=30,vgap=2,gap=4,combo=0,use_blue=0;
 for(int i=1;i<argc;i++){
  if(!strcmp(argv[i],"--combo"))combo=1;
  else if(!strcmp(argv[i],"--blue"))use_blue=1;
  else if(!strcmp(argv[i],"--angle")&&i+1<argc)angle=strtof(argv[++i],NULL);
  else if(!strcmp(argv[i],"--slide-width")&&i+1<argc)slide_w=atoi(argv[++i]);
  else if(!strcmp(argv[i],"--slide-height")&&i+1<argc)slide_h=atoi(argv[++i]);
  else if(!strcmp(argv[i],"--vgap")&&i+1<argc)vgap=atoi(argv[++i]);
  else if(!strcmp(argv[i],"--gap")&&i+1<argc)gap=atoi(argv[++i]);
  else if(!strcmp(argv[i],"--no-color"))no_color=1;
  else if(!strcmp(argv[i],"--help")){
   puts("tube-slide-portable [--combo] [--blue] [--angle N] [--slide-width N] [--slide-height N] [--vgap N] [--gap N] [--no-color]");
   puts("  Default: red stacked layout. --combo for side-by-side. --blue for blue color.");
   return 0;
  }
  else{fprintf(stderr,"Unknown option: %s\n",argv[i]);return 2;}
 }
 if(slide_w<20)slide_w=20;if(slide_h<10)slide_h=10;
 if(slide_w>MAX_W)slide_w=MAX_W;if(slide_h>MAX_H)slide_h=MAX_H;
 if(combo&&slide_w==80)slide_w=60;

 add_tube();add_tower();
 render_3d(slide_w,slide_h,angle);

 int use_color=!no_color;
 int use_red=!use_blue;
 if(combo)output_combo(slide_w,slide_h,gap,use_color,use_red);
 else output_stack(slide_w,slide_h,vgap,use_color,use_red);
 return 0;
}
