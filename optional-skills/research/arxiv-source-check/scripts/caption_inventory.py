#!/usr/bin/env python3
"""Offline, source-bound LaTeXML caption inventory; no expected-count inputs."""
import hashlib, json, re, unicodedata
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

class Node:
    def __init__(self, tag, attrs=(), parent=None, order=0):
        self.tag, self.attrs, self.parent, self.order = tag, dict(attrs), parent, order
        self.children=[]
    @property
    def classes(self): return set(self.attrs.get('class','').split())
    def walk(self):
        yield self
        for c in self.children:
            if isinstance(c,Node): yield from c.walk()
    def text(self):
        if self.tag in {'script','style','annotation'}: return ''
        return ' '.join(c.text() if isinstance(c,Node) else c for c in self.children)
    def ancestors(self):
        p=self.parent
        while p:
            yield p
            p=p.parent

class DOM(HTMLParser):
    VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
    def __init__(self,text):
        super().__init__(convert_charrefs=True);self.root=Node('root');self.stack=[self.root];self.n=0
        self.feed(text)
    def handle_starttag(self,tag,attrs):
        self.n+=1;n=Node(tag,attrs,self.stack[-1],self.n);self.stack[-1].children.append(n)
        if tag not in self.VOID:self.stack.append(n)
    def handle_startendtag(self,tag,attrs): self.handle_starttag(tag,attrs);self.handle_endtag(tag)
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag==tag: self.stack=self.stack[:i];break
    def handle_data(self,data):self.stack[-1].children.append(data)

def clean(s):return re.sub(r'\s+',' ',s).strip()
def norm(s):
    s=unicodedata.normalize('NFKD',s).casefold().replace('ﬁ','fi').replace('ﬂ','fl')
    return re.sub(r'[^a-z0-9]','',s)
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
LABEL=re.compile(r'^(Figure|Fig\.?|Table)\s+([A-Za-z0-9]+(?:[.\-][A-Za-z0-9]+)*)\s*[:.]?\s*',re.I)
PDF_LABEL=re.compile(r'^(Figure|Fig\.?|Table)\s+([A-Za-z0-9]+(?:[.\-][A-Za-z0-9]+)*)\s*[:.]\s*(.*)$',re.I)

def parse_html(text):
    dom=DOM(text);nodes=list(dom.root.walk());docs=[n for n in nodes if 'ltx_document' in n.classes]
    scope=docs[0] if len(docs)==1 else dom.root;nodes=list(scope.walk());warnings=[]
    if len(docs)!=1:warnings.append('missing_or_ambiguous_document_container')
    for n in nodes:
        if any(c.lower() in {'ltx_error','ltx_warning','ltx_missing'} for c in n.classes):
            warnings.append({'conversion_marker':n.attrs.get('id'), 'text':clean(n.text())[:200]})
    # A same-source standalone heading container can introduce supplement sections
    # even when the converter emits ordinary sections instead of ltx_appendix.
    boundaries=[]
    structural={'article','section','main'}
    for n in nodes:
        t=clean(n.text())
        if 'ltx_appendix' in n.classes:
            title=next((x for x in n.children if isinstance(x,Node) and x.tag in {'h1','h2','h3','h4','h5','h6'}),None)
            boundaries.append({'order':n.order,'id':n.attrs.get('id'),'method':'native_appendix_ancestor','heading':clean(title.text()) if title else '', 'scope_order':n.order, 'scope_end':max(x.order for x in n.walk())})
        elif n.tag in {'h1','h2','h3','h4','h5','h6','p'} and re.fullmatch(r'(?:Appendix|Appendices|Supplementary (?:Material|Materials|Information)|Supplemental (?:Material|Materials|Information))',t,re.I):
            # p fallback must be a short standalone source container, not body mention.
            owner=next((a for a in n.ancestors() if a.tag in structural or 'ltx_document' in a.classes),scope)
            boundaries.append({'order':n.order,'id':n.attrs.get('id'),'method':'standalone_source_heading','heading':t,'scope_order':owner.order,'scope_end':max(x.order for x in owner.walk())})
    captions=[];ignored=[];seen=set()
    for n in nodes:
        if n.tag not in {'figcaption','caption'} and 'ltx_caption' not in n.classes:continue
        tags=[x for x in n.walk() if x.classes & {'ltx_tag_figure','ltx_tag_table'}]
        container=next((a for a in n.ancestors() if a.tag in {'figure','table'} or a.classes & {'ltx_figure','ltx_table'}),None)
        if not container:continue
        ct=container.classes
        kind='table' if 'ltx_table' in ct or container.tag=='table' else 'figure'
        # Algorithm captions and panels have distinct native identities and are excluded.
        if 'ltx_figure_panel' in ct or any('algorithm' in c.lower() for c in ct) or 'ltx_float' in ct:
            ignored.append({'id':container.attrs.get('id'),'reason':'algorithm_or_float'});continue
        tag=tags[0] if tags else None
        labeltext=clean(tag.text()) if tag else clean(n.text())
        m=LABEL.match(labeltext)
        if not m:
            ignored.append({'id':container.attrs.get('id'),'tag':labeltext,'reason':'untyped_caption'})
            warnings.append({'untyped_html_caption':container.attrs.get('id'),'text':labeltext[:200]});continue
        detected='table' if m.group(1).lower()=='table' else 'figure'
        if tag and detected!=kind:warnings.append({'caption_container_type_disagreement':container.attrs.get('id')})
        kind=detected;identity=f'{kind}:{m.group(2)}'
        if identity in seen:warnings.append({'duplicate_caption_identity':identity});continue
        seen.add(identity)
        ancestors=list(n.ancestors());native=next((a for a in ancestors if 'ltx_appendix' in a.classes),None)
        standalone=[b for b in boundaries if b['method']=='standalone_source_heading' and b['order']<n.order<=b['scope_end'] and any(a.order==b['scope_order'] for a in ancestors)]
        boundary=next((b for b in boundaries if native and b['order']==native.order),None) if native else (standalone[-1] if standalone else None)
        content=clean(n.text());content=LABEL.sub('',content,count=1).lstrip(': .')
        captions.append({'identity':identity,'kind':kind,'label':m.group(2),'container_id':container.attrs.get('id'),'caption_order':n.order,'tag_text':labeltext,'caption_text':content,'region':'appendix' if boundary else 'main','boundary_evidence':boundary})
    # A source object without its caption is a completeness problem, even if
    # the PDF scanner also misses that caption. Nested data tables are not new
    # separately captioned source objects.
    for n in nodes:
        typed=n.classes & {'ltx_figure','ltx_table'} or n.tag in {'figure','table'}
        if n.tag=='table' and any(a.tag in {'figure','table'} or a.classes & {'ltx_figure','ltx_table'} for a in n.ancestors()):continue
        if any(c.startswith(('ltx_equation','ltx_eqn','ltx_math')) for c in n.classes):continue
        if not typed or 'ltx_figure_panel' in n.classes or 'ltx_float' in n.classes or any('algorithm' in c.lower() for c in n.classes):continue
        direct_caps=[x for x in n.walk() if (x.tag in {'figcaption','caption'} or 'ltx_caption' in x.classes) and next((a for a in x.ancestors() if a.tag in {'figure','table'} or a.classes & {'ltx_figure','ltx_table'}),None) is n]
        if not direct_caps:warnings.append({'missing_html_caption':n.attrs.get('id'),'container_order':n.order})
    return captions,boundaries,ignored,warnings

def pdf_candidates(lit):
    out=[]
    for p in lit['pages']:
        items=p.get('text_items',[])
        for i,item in enumerate(items):
            # Include contiguous same-line words if LiteParse split the prefix.
            same=[x for x in items if abs(x['y']-item['y'])<max(2,item['height']/3) and x['x']>=item['x']]
            same.sort(key=lambda x:x['x'])
            line=clean(' '.join(x['text'] for x in same))
            m=PDF_LABEL.match(line)
            if not m:continue
            kind='table' if m.group(1).lower()=='table' else 'figure'
            content=PDF_LABEL.sub(lambda q:q.group(3),line,count=1)
            out.append({'identity':f'{kind}:{m.group(2)}','page':p['page'],'text_item_index':i,'prefix':content,'bbox':[item['x'],item['y'],item['width'],item['height']],'text':line})
    return out

def analyze(html_path,lit_path,pdf_path,lit_source_path,source):
    pin=source['pin'];h=html_path.read_text();lit=json.loads(lit_path.read_text());prov=json.loads(lit_source_path.read_text())
    issues=[]
    if source.get('url')!=f'https://arxiv.org/html/{pin}':issues.append('source_url_pin_mismatch')
    if sha(html_path)!=source.get('sha256') or html_path.stat().st_size!=source.get('bytes'):issues.append('html_provenance_hash_or_size_mismatch')
    if not re.fullmatch(r'(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]+/\d{7})v\d+',pin,re.I):issues.append('unpinned_source_version')
    if not re.search(r'(?:href|content)=["\'][^"\']*(?:/abs/|/html/)'+re.escape(pin)+r'(?:["\'#?])',h):issues.append('html_pin_not_in_native_link_metadata')
    if sha(pdf_path)!=prov.get('pdf_sha256'):issues.append('pdf_source_hash_mismatch')
    if sha(lit_path)!=prov.get('extraction_sha256'):issues.append('extraction_hash_mismatch')
    if prov.get('tool')!='LiteParse':issues.append('extraction_tool_not_LiteParse')
    if not lit['pages'] or f'arXiv:{pin}' not in lit['pages'][0].get('text',''):issues.append('pdf_version_watermark_mismatch')
    captions,bounds,ignored,warnings=parse_html(h);candidates=pdf_candidates(lit);matched=set()
    for cap in captions:
        words=cap['caption_text'].split();prefix=norm(' '.join(words[:6]));hits=[]
        for i,c in enumerate(candidates):
            if c['identity']==cap['identity'] and prefix and norm(c['prefix']).startswith(prefix):hits.append((i,c))
        cap['pdf_matches']=[c for _,c in hits]
        cap['verification']='verified' if len(hits)==1 and not issues else ('ambiguous' if len(hits)>1 else 'unmatched')
        cap['source_prefix_evidence']=' '.join(words[:6])
        if len(hits)==1:matched.add(hits[0][0])
    unmatched=[c for i,c in enumerate(candidates) if i not in matched]
    # A wrapped PDF body reference may begin a line like a caption. Exclude it only
    # with same-source paragraph and linked native figure/table identity evidence.
    refs=[];body=[]
    for n in DOM(h).root.walk():
        if n.tag!='p' or any(a.tag in {'figcaption','caption'} for a in n.ancestors()):continue
        links=[]
        for a in n.walk():
            if a.tag=='a' and 'ltx_ref' in a.classes:
                m=LABEL.match(clean(a.text()))
                if m:links.append(('table' if m.group(1).lower()=='table' else 'figure')+':'+m.group(2))
        if links:body.append((n,links))
    still=[]
    for c in unmatched:
        prefix=norm(' '.join(c['prefix'].split()[:6]))
        evidence=[{'paragraph_id':n.attrs.get('id'),'paragraph_text':clean(n.text())[:600]} for n,ids in body if c['identity'] in ids and prefix and prefix in norm(n.text())]
        if evidence:refs.append(dict(c,classification='source_bound_body_reference',source_evidence=evidence))
        else:still.append(c)
    unmatched=still
    for bound in bounds:
        target=norm(re.sub(r'^Appendix\s+','',bound['heading'],flags=re.I))
        bound['pdf_heading_matches']=[{'page':page['page'],'text_item_index':i,'bbox':[item['x'],item['y'],item['width'],item['height']],'text':item['text']} for page in lit['pages'] for i,item in enumerate(page.get('text_items',[])) if target and norm(item['text'])==target]
        bound['pdf_heading_verification']='verified' if len(bound['pdf_heading_matches'])==1 else 'unverified'

    unverified=[c['identity'] for c in captions if c['verification']!='verified']
    counts={region:dict(Counter(c['kind'] for c in captions if c['region']==region)) for region in ('main','appendix')}
    for region in counts:
        for kind in ('figure','table'):counts[region].setdefault(kind,0)
    return {'schema':'structured-caption-inventory-v1','pin':pin,'source':source,'pdf_provenance':prov,'counts':counts,'boundaries':bounds,'caption_identities':captions,'ignored':ignored,'provenance_issues':issues,'conversion_warnings':warnings,'unverified_source_identities':unverified,'unmatched_pdf_candidates':unmatched,'excluded_pdf_body_references':refs,'accepted_counts':counts if not (issues or warnings or unverified or unmatched) else None,'status':'verified' if not (issues or warnings or unverified or unmatched) else 'unverified','limitations':['PDF candidates require caption label punctuation plus matching source prefix; labels alone never verify identity.','HTML conversion completeness is only accepted when every source identity binds once and every PDF caption candidate is accounted for.']}
