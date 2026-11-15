// Tube Slide Router - terminal 3D ASCII renderer
// Original implementation inspired by the rendering approach of areofyl/fetch.
// No source code from fetch is copied. MIT-like standalone sample.
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <time.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <fcntl.h>

#define PI 3.14159265358979323846f
#define MAX_POINTS 230000
#define MAX_W 220
#define MAX_H 80

typedef struct {float x,y,z;} V;
typedef struct {V p,n; unsigned char part;} P;
static P pts[MAX_POINTS];static int npts=0;
static float depth[MAX_W*MAX_H];static char pix[MAX_W*MAX_H];static unsigned char colors[MAX_W*MAX_H];
static struct termios oldterm;static int raw=0;
static volatile sig_atomic_t quit=0;
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
// A descending spiral wrapped around the support tower.
// Each section is an actual circular tube, not a flat 2D extrusion.
static V center(float t){
 float a=PI*.80f + 2*PI*2.65f*t;
 float r=1.14f + .12f*sinf(t*PI*4);
 float x=r*cosf(a), z=.78f*r*sinf(a);
 float y=3.62f-3.03f*t;
 // Transition to the ground-level outward-facing outlet.
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
   // tube is slightly tapered at the entrance and at the lip
   float radius=.31f + .045f*sinf(t*PI);
   emit(add(c,mul(radial,radius)),radial,1);
  }
 }
 // Segment seams / framing rings emphasize the iconic slide geometry.
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
 // platform below roof
 for(int i=0;i<2;i++){float z=i?-.55f:.55f;cylinder(v(-.77f,3.73f,z),v(.77f,3.73f,z),.061f,3);}
 for(int i=0;i<2;i++){float x=i?-.77f:.77f;cylinder(v(x,3.73f,-.55f),v(x,3.73f,.55f),.061f,3);}
 // lower platform guard rails seen behind the slide
 cylinder(v(-.72f,3.12f,.55f),v(.72f,3.12f,.55f),.045f,3);
 cylinder(v(-.72f,2.74f,.55f),v(-.72f,3.62f,.55f),.047f,3);
 cylinder(v(.72f,2.74f,.55f),v(.72f,3.62f,.55f),.047f,3);
 // dome canopy, hemispherical arch with perimeter and rib
 for(int i=0;i<=55;i++){float phi=PI*i/55;float x=1.02f*cosf(phi),y=4.13f+.76f*sinf(phi);
  cylinder(v(x,y,-.65f),v(x,y,.65f),.018f,4);}
 for(int j=0;j<=90;j++){float a=2*PI*j/90;float x=1.02f*cosf(a),z=.69f*sinf(a);
  emit(v(x,4.13f,z),v(cosf(a),0,sinf(a)),4);
  for(int i=1;i<=15;i++){float elev=(PI/2)*i/15;float k=cosf(elev);
   V p=v(x*k,4.13f+.77f*sinf(elev),z*k);emit(p,norm(v(x*k,sinf(elev),z*k)),4);}}
 // tower base
 cylinder(v(-1.1f,.12f,-.85f),v(1.1f,.12f,-.85f),.048f,3);
 cylinder(v(-1.1f,.12f,.85f),v(1.1f,.12f,.85f),.048f,3);
}
static V rot(V p,float ay,float ax){
 float c=cosf(ay),s=sinf(ay);p=v(p.x*c+p.z*s,p.y,-p.x*s+p.z*c);
 c=cosf(ax);s=sinf(ax);return v(p.x,p.y*c-p.z*s,p.y*s+p.z*c);
}
static void restore(){if(raw){tcsetattr(STDIN_FILENO,TCSANOW,&oldterm);raw=0;}fputs("\033[?25h\033[0m\n",stdout);fflush(stdout);}
static void stop_sig(int sig){(void)sig;quit=1;}
static void render(int width,int height,float turn,int use_color,int with_info,int frame,int static_mode){
 if(width>MAX_W)width=MAX_W;
 if(height>MAX_H)height=MAX_H;
 int total=width*height;for(int i=0;i<total;i++){depth[i]=-1e9f;pix[i]=' ';colors[i]=0;}
 const char *ramp=".,-~:;=!*#$@";int maxshade=(int)strlen(ramp)-1;
 V light=norm(v(-.4f,.73f,1.0f));
 for(int i=0;i<npts;i++){
  V p=rot(sub(pts[i].p,v(0,2.40f,0)),turn,.18f),normal=rot(pts[i].n,turn,.18f);
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
 if(!static_mode)printf("\033[H");
 for(int y=0;y<height;y++){
  int prev=-1;
  for(int x=0;x<width;x++){
   int k=y*width+x;int col=colors[k];
   if(use_color&&col!=prev){
    const char*ansi=col==1?"\033[38;5;196m":col==2?"\033[38;5;203m":col==3?"\033[38;5;246m":col==4?"\033[38;5;255m":"\033[0m";
    fputs(ansi,stdout);prev=col;
   }
   putchar(pix[k]);
  }
  if(static_mode)fputs("\033[0m\n",stdout);
  else fputs("\033[0m\033[K\n",stdout);
 }
 if(with_info){printf("\033[1;31m  TUBE SLIDE ROUTER\033[0m  |  3D ASCII Mesh  |  frame %d\033[K\n",frame);
 printf("  Model / Effort Intelligent Routing\033[K");}
 fflush(stdout);
}
int main(int argc,char**argv){
 float speed=.8f,angle=0;int frames=0,no_color=0,no_info=0,width=0,height=0,static_mode=0;
 for(int i=1;i<argc;i++){
  if(!strcmp(argv[i],"--speed")&&i+1<argc)speed=strtof(argv[++i],NULL);
  else if(!strcmp(argv[i],"--frames")&&i+1<argc)frames=atoi(argv[++i]);
  else if(!strcmp(argv[i],"--width")&&i+1<argc)width=atoi(argv[++i]);
  else if(!strcmp(argv[i],"--height")&&i+1<argc)height=atoi(argv[++i]);
  else if(!strcmp(argv[i],"--angle")&&i+1<argc)angle=strtof(argv[++i],NULL);
  else if(!strcmp(argv[i],"--no-color"))no_color=1;
  else if(!strcmp(argv[i],"--no-info"))no_info=1;
  else if(!strcmp(argv[i],"--static"))static_mode=1;
  else if(!strcmp(argv[i],"--help")){puts("tube-slide [--static] [--angle N] [--speed N] [--frames N] [--width N] [--height N] [--no-color] [--no-info]");return 0;}
  else {fprintf(stderr,"Unknown option: %s\n",argv[i]);return 2;}
 }
 if((!width||!height)&&isatty(STDOUT_FILENO)){
  struct winsize ws;
  if(ioctl(STDOUT_FILENO,TIOCGWINSZ,&ws)==0){
   if(!width)width=ws.ws_col?ws.ws_col:94;
   if(!height)height=(ws.ws_row?ws.ws_row:44)-3;
  }
 }
 if(!width)width=94;
 if(!height)height=42;
 if(width<36)width=36;
 if(height<16)height=16;
 if(width>MAX_W)width=MAX_W;
 if(height>MAX_H)height=MAX_H;
 add_tube();add_tower();
 if(static_mode){
  render(width,height,angle,!no_color,!no_info,0,1);
  return 0;
 }
 signal(SIGINT,stop_sig);signal(SIGTERM,stop_sig);
 int original_flags=-1;
 if(isatty(STDIN_FILENO)){if(tcgetattr(STDIN_FILENO,&oldterm)==0){struct termios t=oldterm;t.c_lflag&=(tcflag_t)~(ICANON|ECHO);t.c_cc[VMIN]=0;t.c_cc[VTIME]=0;if(tcsetattr(STDIN_FILENO,TCSANOW,&t)==0)raw=1;}
  original_flags=fcntl(STDIN_FILENO,F_GETFL,0);if(original_flags>=0)fcntl(STDIN_FILENO,F_SETFL,original_flags|O_NONBLOCK);}
 fputs("\033[2J\033[?25l",stdout);fflush(stdout);
 struct timespec nap={0,33000000L};int i=0;
 while(!quit&&(frames==0||i<frames)){
  render(width,height,i*(speed*.035f),!no_color,!no_info,i,0);
  char key;ssize_t nr=raw?read(STDIN_FILENO,&key,1):0;if(nr>0&&(key=='q'||key=='Q'||key==27))break;
  nanosleep(&nap,NULL);i++;
 }
 if(original_flags>=0)fcntl(STDIN_FILENO,F_SETFL,original_flags);
 restore();return 0;
}
