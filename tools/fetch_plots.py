import json,urllib.request,urllib.parse,re,time,os
UA={'User-Agent':'FriendsQuizBot/1.0 (educational)'}
def get(u):
    for i in range(4):
        try: return json.loads(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=40).read())
        except Exception as e:
            time.sleep(3*(i+1))
    return None
titles=json.load(open('fd_titles.json'))
eps=json.load(open('eps.json')) if os.path.exists('eps.json') else {}
for t in titles:
    if t in eps or t.startswith('User') or 'Reunion' in t: continue
    d=get("https://friends.fandom.com/api.php?action=parse&page="+urllib.parse.quote(t.replace(' ','_'))+"&prop=wikitext&format=json&redirects=1")
    if not d or 'parse' not in d: eps[t]=None; continue
    w=d['parse']['wikitext']['*']
    def f(k):
        m=re.search(r'\|\s*'+k+r'\s*=\s*(.*)',w); return m.group(1).strip() if m else ''
    m=re.search(r'==\s*Plot\s*==(.*?)(?=\n==[^=])',w,re.S)
    eps[t]={'season':f('season'),'episode':f('episode'),'airdate':f('airdate'),'plot':m.group(1).strip() if m else ''}
    json.dump(eps,open('eps.json','w'),ensure_ascii=False)
    time.sleep(0.4)
print(len(eps), sum(1 for v in eps.values() if v and v['plot']))
