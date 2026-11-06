const HTML_PAGES={'/admin/stats':'stats','/admin/chats':'chats',
  '/admin/knowledge':'knowledge','/admin/profile':'profile'};
const CONTENT_HEADERS={
  'Cache-Control':'no-store, no-cache, must-revalidate','Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
  'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"
};
export function createAdminUiRoutes({html,css,js}={}){
  const present=typeof html==='string'&&html.includes('__PAGE__')&&
    typeof css==='string'&&typeof js==='string';
  return request=>{
    const {pathname}=new URL(request.url);
    if(pathname==='/admin')return Response.redirect(new URL('/admin/stats',request.url),302);
    if(!Object.hasOwn(HTML_PAGES,pathname)&&
      !['/admin/assets/style.css','/admin/assets/app.js'].includes(pathname))return null;
    if(request.method!=='GET')return new Response(null,{status:405});
    if(!present)return new Response('Admin UI assets not installed',{status:503,headers:CONTENT_HEADERS});
    const isHtml=Object.hasOwn(HTML_PAGES,pathname);
    const type=isHtml?'text/html; charset=utf-8':
      pathname.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8';
    const body=isHtml?html.replace('__PAGE__',HTML_PAGES[pathname]):
      pathname.endsWith('.css')?css:js;
    return new Response(body,{status:200,headers:{...CONTENT_HEADERS,'Content-Type':type}});
  };
}
