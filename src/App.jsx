import { useEffect, useMemo, useState } from 'react'
import { supabase, supabaseConfigured } from './supabase'

const APP_VERSION = '2.0.0'
const NOTE_CATEGORIES = ['スマホ', 'PC', '料理', '仕事', '生活', 'ChatGPT', 'その他']
const ITEM_CATEGORIES = ['ガジェット', '家電', '工具', 'スポーツ', '防災', '書類', 'その他']
const STATUSES = ['所持中（使用中）', '所持中（未使用）', '所持中（使用終わり）', '故障', '紛失・廃棄', '売却済み']

const emptyNote = { title:'', category:'その他', tags:[], body:'', steps:'', caution:'', reference_url:'', favorite:false }
const emptyItem = { name:'', category:'その他', maker:'', model_number:'', purchase_date:'', shop:'', price:'', warranty_until:'', storage_place:'', manual_url:'', consumables_memo:'', free_memo:'', tags:[], status:'所持中（使用中）', favorite:false }

function parseTags(value) {
  if (Array.isArray(value)) return [...new Set(value.map(String).map(v=>v.trim()).filter(Boolean))]
  return [...new Set(String(value || '').split(/[\s,、，]+/u).map(v=>v.trim()).filter(Boolean))]
}
function tagsText(tags){ return Array.isArray(tags) ? tags.join(' ') : '' }
function fmtDate(v){ if(!v) return '—'; const d=new Date(v); if(Number.isNaN(d.getTime())) return String(v); return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit'}).format(d) }
function fmtDateTime(v){ if(!v) return '—'; const d=new Date(v); if(Number.isNaN(d.getTime())) return String(v); return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d) }
function uuid(){ return crypto.randomUUID() }
function isUuid(v){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'')) }
function normalizeStatus(v){ return v === '所持中' || !STATUSES.includes(v) ? '所持中（使用中）' : v }
function errText(error){ return error?.message || String(error || '不明なエラー') }

function App(){
  const [session,setSession]=useState(null)
  const [authLoading,setAuthLoading]=useState(true)
  const [notes,setNotes]=useState([])
  const [items,setItems]=useState([])
  const [images,setImages]=useState([])
  const [imageUrls,setImageUrls]=useState({})
  const [view,setView]=useState('home')
  const [query,setQuery]=useState('')
  const [busy,setBusy]=useState(false)
  const [syncText,setSyncText]=useState('未同期')
  const [editor,setEditor]=useState(null)
  const [detail,setDetail]=useState(null)
  const [statusFilter,setStatusFilter]=useState('すべて')
  const [itemSort,setItemSort]=useState('purchase_desc')
  const [importPreview,setImportPreview]=useState(null)

  useEffect(()=>{
    if(!supabaseConfigured){ setAuthLoading(false); return }
    supabase.auth.getSession().then(({data})=>{ setSession(data.session); setAuthLoading(false) })
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s))
    return ()=>subscription.unsubscribe()
  },[])

  useEffect(()=>{ if(session) loadAll(); else {setNotes([]);setItems([]);setImages([]);setImageUrls({})} },[session])

  async function loadAll(){
    setBusy(true); setSyncText('同期中…')
    try{
      const [n,i,img]=await Promise.all([
        supabase.from('notes').select('*').order('updated_at',{ascending:false}),
        supabase.from('items').select('*').order('updated_at',{ascending:false}),
        supabase.from('image_files').select('*').order('created_at',{ascending:true}),
      ])
      if(n.error) throw n.error; if(i.error) throw i.error; if(img.error) throw img.error
      setNotes(n.data||[]); setItems((i.data||[]).map(x=>({...x,status:normalizeStatus(x.status)}))); setImages(img.data||[])
      await refreshSignedUrls(img.data||[])
      setSyncText(`同期済み ${new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`)
    }catch(e){ setSyncText('同期エラー'); alert(`データ取得に失敗しました。\n${errText(e)}`) }
    finally{ setBusy(false) }
  }

  async function refreshSignedUrls(rows){
    const map={}
    await Promise.all((rows||[]).map(async row=>{
      const {data,error}=await supabase.storage.from('memo-images').createSignedUrl(row.storage_path,3600)
      if(!error && data?.signedUrl) map[row.id]=data.signedUrl
    }))
    setImageUrls(map)
  }

  const noteEntries=useMemo(()=>notes.filter(n=>matchesNote(n,query)),[notes,query])
  const itemEntries=useMemo(()=>{
    let arr=items.filter(i=>matchesItem(i,query) && (statusFilter==='すべて'||i.status===statusFilter))
    arr=[...arr].sort((a,b)=>{
      if(itemSort==='purchase_asc') return (a.purchase_date||'9999').localeCompare(b.purchase_date||'9999')
      if(itemSort==='updated_desc') return String(b.updated_at||'').localeCompare(String(a.updated_at||''))
      return (b.purchase_date||'').localeCompare(a.purchase_date||'') || String(b.updated_at||'').localeCompare(String(a.updated_at||''))
    })
    return arr
  },[items,query,statusFilter,itemSort])

  function firstImage(type,id){ const row=images.find(x=>x.parent_type===type&&x.parent_id===id); return row ? imageUrls[row.id] : '' }

  if(authLoading) return <div className="center-screen">読み込み中…</div>
  if(!supabaseConfigured) return <SetupMissing />
  if(!session) return <AuthScreen />

  return <div className="app-shell">
    <header className="app-header">
      <div><div className="eyebrow">個人用ナレッジ・持ち物台帳</div><h1>思い出しメモ</h1><div className="subline">v{APP_VERSION}　<span className={syncText.includes('エラー')?'sync bad':'sync'}>☁ {syncText}</span></div></div>
      <button className="icon-button" onClick={()=>setView('settings')} aria-label="設定">⚙️</button>
    </header>

    <section className="search-panel">
      <label>あれどうやる？ / どこにある？</label>
      <div className="search-row"><span>🔍</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="例：iPhone 再起動、Anker、保証、料理"/><button className="text-button" onClick={()=>setQuery('')}>消去</button></div>
    </section>

    <div className="top-actions"><button className="primary-action" onClick={()=>setEditor({type:'note',data:null})}>＋ 小ネタ</button><button className="primary-action secondary" onClick={()=>setEditor({type:'item',data:null})}>＋ 持ち物</button></div>
    <nav className="tab-bar">{[['home','ホーム'],['notes','小ネタ'],['items','持ち物'],['settings','設定']].map(([k,l])=><button key={k} className={view===k?'tab active':'tab'} onClick={()=>setView(k)}>{l}</button>)}</nav>

    <main className="main-content">
      {view==='home' && <Home notes={notes} items={items} imageFor={firstImage} open={(type,data)=>setDetail({type,data})} setView={setView}/>} 
      {view==='notes' && <NotesView entries={noteEntries} imageFor={firstImage} open={data=>setDetail({type:'note',data})}/>} 
      {view==='items' && <ItemsView entries={itemEntries} imageFor={firstImage} open={data=>setDetail({type:'item',data})} statusFilter={statusFilter} setStatusFilter={setStatusFilter} itemSort={itemSort} setItemSort={setItemSort}/>} 
      {view==='settings' && <Settings session={session} notes={notes} items={items} busy={busy} syncText={syncText} loadAll={loadAll} onExport={exportBackup} onImport={handleImportFile} onSignOut={()=>supabase.auth.signOut()}/>} 
    </main>

    {editor && <EditorModal editor={editor} onClose={()=>setEditor(null)} onSave={saveEntry} existingImage={editor.data?firstImage(editor.type,editor.data.id):''}/>} 
    {detail && <DetailModal detail={detail} image={firstImage(detail.type,detail.data.id)} onClose={()=>setDetail(null)} onEdit={()=>{setEditor(detail);setDetail(null)}} onDelete={()=>deleteEntry(detail.type,detail.data)}/>} 
    {importPreview && <ImportModal preview={importPreview} onClose={()=>setImportPreview(null)} onApply={applyImport}/>} 
  </div>

  async function saveEntry(type,data,file,removeImage){
    setBusy(true)
    try{
      const table=type==='note'?'notes':'items'
      const payload=type==='note'?{
        title:data.title.trim(), category:data.category||'その他', tags:parseTags(data.tags), body:data.body||'', steps:data.steps||'', caution:data.caution||'', reference_url:data.reference_url||'', favorite:Boolean(data.favorite), user_id:session.user.id,
      }:{
        name:data.name.trim(), category:data.category||'その他', maker:data.maker||'', model_number:data.model_number||'', purchase_date:data.purchase_date||null, shop:data.shop||'', price:data.price===''||data.price==null?null:Number(data.price), warranty_until:data.warranty_until||null, storage_place:data.storage_place||'', manual_url:data.manual_url||'', consumables_memo:data.consumables_memo||'', free_memo:data.free_memo||'', tags:parseTags(data.tags), status:normalizeStatus(data.status), favorite:Boolean(data.favorite), user_id:session.user.id,
      }
      let id=data.id
      if(id){ const {error}=await supabase.from(table).update(payload).eq('id',id); if(error) throw error }
      else { const {data:created,error}=await supabase.from(table).insert(payload).select('id').single(); if(error) throw error; id=created.id }
      if(removeImage) await removeParentImages(type,id)
      if(file){ await removeParentImages(type,id); await uploadImage(type,id,file) }
      setEditor(null); await loadAll(); setView(type==='note'?'notes':'items')
    }catch(e){ alert(`保存に失敗しました。\n${errText(e)}`) }
    finally{ setBusy(false) }
  }

  async function uploadImage(type,parentId,file){
    const ext=(file.name?.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg'
    const path=`${session.user.id}/${type==='note'?'notes':'items'}/${parentId}/${Date.now()}-${uuid()}.${ext}`
    const {error:upErr}=await supabase.storage.from('memo-images').upload(path,file,{upsert:false,contentType:file.type||undefined}); if(upErr) throw upErr
    const {error:dbErr}=await supabase.from('image_files').insert({user_id:session.user.id,parent_type:type,parent_id:parentId,storage_path:path}); if(dbErr){ await supabase.storage.from('memo-images').remove([path]); throw dbErr }
  }
  async function removeParentImages(type,parentId){
    const rows=images.filter(x=>x.parent_type===type&&x.parent_id===parentId)
    if(!rows.length){ const {data}=await supabase.from('image_files').select('*').eq('parent_type',type).eq('parent_id',parentId); rows.push(...(data||[])) }
    if(rows.length){ await supabase.storage.from('memo-images').remove(rows.map(x=>x.storage_path)); const {error}=await supabase.from('image_files').delete().eq('parent_type',type).eq('parent_id',parentId); if(error) throw error }
  }
  async function deleteEntry(type,data){
    if(!confirm('削除します。よろしいですか？')) return
    try{ setBusy(true); await removeParentImages(type,data.id); const {error}=await supabase.from(type==='note'?'notes':'items').delete().eq('id',data.id); if(error) throw error; setDetail(null); await loadAll() }catch(e){alert(`削除に失敗しました。\n${errText(e)}`)}finally{setBusy(false)}
  }

  async function exportBackup(){
    try{
      setBusy(true)
      const notesOut=await Promise.all(notes.map(n=>recordWithImage('note',n)))
      const itemsOut=await Promise.all(items.map(i=>recordWithImage('item',i)))
      const payload={app:'思い出しメモ',version:APP_VERSION,exportedAt:new Date().toISOString(),notes:notesOut.map(toLegacyNote),items:itemsOut.map(toLegacyItem)}
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})
      const filename=`omoidasimemo-backup-${new Date().toISOString().slice(0,10)}.json`
      const file=new File([blob],filename,{type:'application/json'})
      if(navigator.canShare?.({files:[file]})&&navigator.share){ try{ await navigator.share({title:'思い出しメモ バックアップ',files:[file]}); return }catch(e){ if(e?.name==='AbortError') return } }
      const u=URL.createObjectURL(blob); const a=document.createElement('a');a.href=u;a.download=filename;a.click();URL.revokeObjectURL(u)
    }catch(e){ alert(`バックアップに失敗しました。\n${errText(e)}`) }finally{setBusy(false)}
  }
  async function recordWithImage(type,record){
    const row=images.find(x=>x.parent_type===type&&x.parent_id===record.id); if(!row) return {...record,photo:''}
    const {data,error}=await supabase.storage.from('memo-images').download(row.storage_path); if(error) return {...record,photo:''}
    return {...record,photo:await blobToDataUrl(data)}
  }
  function toLegacyNote(n){ return {id:n.id,type:'note',title:n.title,category:n.category,tags:n.tags,photo:n.photo||'',body:n.body,steps:n.steps,caution:n.caution,url:n.reference_url,favorite:n.favorite,createdAt:n.created_at,updatedAt:n.updated_at} }
  function toLegacyItem(i){ return {id:i.id,type:'item',name:i.name,category:i.category,ownershipStatus:i.status,maker:i.maker,modelNumber:i.model_number,photo:i.photo||'',purchaseDate:i.purchase_date||'',shop:i.shop,price:i.price??'',warrantyUntil:i.warranty_until||'',storagePlace:i.storage_place,manualUrl:i.manual_url,consumablesMemo:i.consumables_memo,freeMemo:i.free_memo,tags:i.tags,favorite:i.favorite,createdAt:i.created_at,updatedAt:i.updated_at} }

  async function handleImportFile(file){
    try{ const raw=JSON.parse(await file.text()); const normalized=normalizeImport(raw); const preview=computePreview(normalized,notes,items); setImportPreview({raw:normalized,preview}) }catch(e){alert(`JSONを読み込めません。\n${errText(e)}`)}
  }
  async function applyImport(mode){
    const data=importPreview?.raw; if(!data) return
    setBusy(true)
    try{
      if(mode==='replace'){
        const ownImgs=images.map(x=>x.storage_path); if(ownImgs.length) await supabase.storage.from('memo-images').remove(ownImgs)
        let r=await supabase.from('image_files').delete().eq('user_id',session.user.id); if(r.error) throw r.error
        r=await supabase.from('notes').delete().eq('user_id',session.user.id); if(r.error) throw r.error
        r=await supabase.from('items').delete().eq('user_id',session.user.id); if(r.error) throw r.error
        await importRecords(data,'replace')
      } else await importRecords(data,mode)
      setImportPreview(null); await loadAll(); alert('復元が完了しました。')
    }catch(e){alert(`復元に失敗しました。\n${errText(e)}`)}finally{setBusy(false)}
  }
  async function importRecords(data,mode){
    for(const n of data.notes) await importOne('note',n,mode)
    for(const i of data.items) await importOne('item',i,mode)
  }
  async function importOne(type,rec,mode){
    const table=type==='note'?'notes':'items'; const currentList=type==='note'?notes:items
    const current=currentList.find(x=>x.id===rec.id || (rec.legacy_id && x.legacy_id===rec.legacy_id))
    if(mode==='diff' && current){ const importedTime=new Date(rec.updated_at||0).getTime(); const localTime=new Date(current.updated_at||0).getTime(); if(importedTime<=localTime) return }
    const forceNew=mode==='merge'; const id=forceNew?uuid():(current?.id || (isUuid(rec.id)?rec.id:uuid()))
    const payload=type==='note'?{
      id,user_id:session.user.id,legacy_id:forceNew?null:(rec.legacy_id||(!isUuid(rec.id)?String(rec.id):null)),title:rec.title,category:rec.category,tags:rec.tags,body:rec.body,steps:rec.steps,caution:rec.caution,reference_url:rec.reference_url,favorite:rec.favorite,created_at:rec.created_at,updated_at:rec.updated_at,
    }:{
      id,user_id:session.user.id,legacy_id:forceNew?null:(rec.legacy_id||(!isUuid(rec.id)?String(rec.id):null)),name:rec.name,category:rec.category,maker:rec.maker,model_number:rec.model_number,purchase_date:rec.purchase_date||null,shop:rec.shop,price:rec.price===''?null:rec.price,warranty_until:rec.warranty_until||null,storage_place:rec.storage_place,manual_url:rec.manual_url,consumables_memo:rec.consumables_memo,free_memo:rec.free_memo,tags:rec.tags,status:normalizeStatus(rec.status),favorite:rec.favorite,created_at:rec.created_at,updated_at:rec.updated_at,
    }
    const {error}=await supabase.from(table).upsert(payload,{onConflict:'id'}); if(error) throw error
    if(rec.photo){ if(current&&!forceNew) await removeParentImages(type,id); const blob=dataUrlToBlob(rec.photo); const file=new File([blob],`import.${mimeExt(blob.type)}`,{type:blob.type}); await uploadImage(type,id,file) }
  }
}

function matchesNote(n,q){ const s=q.trim().toLowerCase(); if(!s)return true; return [n.title,n.category,...(n.tags||[]),n.body,n.steps,n.caution,n.reference_url].join(' ').toLowerCase().includes(s) }
function matchesItem(i,q){ const s=q.trim().toLowerCase(); if(!s)return true; return [i.name,i.category,i.status,i.maker,i.model_number,i.shop,i.storage_place,i.manual_url,i.consumables_memo,i.free_memo,...(i.tags||[]),i.purchase_date,i.warranty_until].join(' ').toLowerCase().includes(s) }

function Home({notes,items,imageFor,open,setView}){
  const favorites=[...notes.filter(x=>x.favorite).map(x=>({type:'note',data:x})),...items.filter(x=>x.favorite).map(x=>({type:'item',data:x}))].slice(0,5)
  const recent=[...notes.map(x=>({type:'note',data:x,date:x.updated_at})),...items.map(x=>({type:'item',data:x,date:x.updated_at}))].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,6)
  return <>
    <section className="stats"><Stat n={notes.length} label="小ネタ"/><Stat n={items.length} label="持ち物"/><Stat n={notes.length+items.length} label="合計"/></section>
    <Section title="よく見る" action={favorites.length?null:<button onClick={()=>setView('notes')}>小ネタを見る</button>}>
      {favorites.length?favorites.map(x=><EntryCard key={x.type+x.data.id} type={x.type} data={x.data} image={imageFor(x.type,x.data.id)} onClick={()=>open(x.type,x.data)}/>):<Empty text="お気に入りはまだありません。"/>}
    </Section>
    <Section title="最近更新"><div className="card-list">{recent.length?recent.map(x=><EntryCard key={x.type+x.data.id} type={x.type} data={x.data} image={imageFor(x.type,x.data.id)} onClick={()=>open(x.type,x.data)}/>):<Empty text="まだ登録がありません。"/>}</div></Section>
  </>
}
function NotesView({entries,imageFor,open}){ return <Section title={`小ネタ ${entries.length}件`}><div className="card-list">{entries.length?entries.map(n=><EntryCard key={n.id} type="note" data={n} image={imageFor('note',n.id)} onClick={()=>open(n)}/>):<Empty text="該当する小ネタがありません。"/>}</div></Section> }
function ItemsView({entries,imageFor,open,statusFilter,setStatusFilter,itemSort,setItemSort}){ return <>
  <div className="filters"><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option>すべて</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select><select value={itemSort} onChange={e=>setItemSort(e.target.value)}><option value="purchase_desc">購入日 新しい順</option><option value="purchase_asc">購入日 古い順</option><option value="updated_desc">更新日 新しい順</option></select></div>
  <Section title={`持ち物 ${entries.length}件`}><div className="card-list">{entries.length?entries.map(i=><EntryCard key={i.id} type="item" data={i} image={imageFor('item',i.id)} onClick={()=>open(i)}/>):<Empty text="該当する持ち物がありません。"/>}</div></Section>
</> }
function EntryCard({type,data,image,onClick}){
  const title=type==='note'?data.title:data.name
  const meta=type==='note'?`${data.category}　${fmtDate(data.updated_at)}`:`${data.maker||'メーカー未登録'} ${data.model_number||''}`
  const preview=type==='note'?(data.body||data.steps||'本文なし'):`購入日：${data.purchase_date||'未設定'}　状態：${data.status}`
  return <button className="entry-card" onClick={onClick}>{image&&<img src={image} alt=""/>}<div className="entry-main"><div className="entry-title">{data.favorite&&'★ '}{title||'無題'}</div><div className="entry-meta">{meta}</div><div className="entry-preview">{preview}</div><div className="tags">{(data.tags||[]).slice(0,5).map(t=><span key={t}>#{t}</span>)}</div></div></button>
}
function Stat({n,label}){return <div className="stat"><strong>{n}</strong><span>{label}</span></div>}
function Section({title,children,action}){return <section className="section"><div className="section-head"><h2>{title}</h2>{action}</div>{children}</section>}
function Empty({text}){return <div className="empty">📝<p>{text}</p></div>}

function EditorModal({editor,onClose,onSave,existingImage}){
  const type=editor.type; const [data,setData]=useState(type==='note'?{...emptyNote,...(editor.data||{}),tags:tagsText(editor.data?.tags)}:{...emptyItem,...(editor.data||{}),tags:tagsText(editor.data?.tags)})
  const [file,setFile]=useState(null); const [removeImage,setRemoveImage]=useState(false)
  const preview=file?URL.createObjectURL(file):(!removeImage?existingImage:'')
  const field=(k,label,typeInput='text',placeholder='')=><label className="field"><span>{label}</span><input type={typeInput} value={data[k]??''} placeholder={placeholder} onChange={e=>setData({...data,[k]:e.target.value})}/></label>
  const area=(k,label,placeholder='')=><label className="field"><span>{label}</span><textarea value={data[k]??''} placeholder={placeholder} onChange={e=>setData({...data,[k]:e.target.value})}/></label>
  return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>{editor.data?'編集':'追加'}：{type==='note'?'小ネタ':'持ち物'}</h2><button onClick={onClose}>×</button></div><div className="modal-body">
    <label className="field"><span>{type==='note'?'画像':'写真'}</span><input type="file" accept="image/*" onChange={e=>{setFile(e.target.files?.[0]||null);setRemoveImage(false)}}/></label>{preview&&<img className="edit-preview" src={preview} alt="プレビュー"/>}{existingImage&&<label className="check"><input type="checkbox" checked={removeImage} onChange={e=>setRemoveImage(e.target.checked)}/>画像を削除する</label>}
    {type==='note'?<>{field('title','タイトル','text','例：iPhoneの完全再起動')}<SelectField label="カテゴリ" value={data.category} options={NOTE_CATEGORIES} onChange={v=>setData({...data,category:v})}/>{field('tags','タグ（スペース・カンマ区切り）','text','例：iPhone 再起動 不具合対応')}{area('body','本文','概要や結論')}{area('steps','手順','1. ...\n2. ...')}{area('caution','注意点','失敗しやすい点など')}{field('reference_url','参考URL','url','https://...')}<CheckField label="お気に入り" checked={data.favorite} onChange={v=>setData({...data,favorite:v})}/></>:<>
      {field('name','品名','text','例：モバイルバッテリー')}<SelectField label="カテゴリ" value={data.category} options={ITEM_CATEGORIES} onChange={v=>setData({...data,category:v})}/><SelectField label="所持状況" value={data.status} options={STATUSES} onChange={v=>setData({...data,status:v})}/><div className="two">{field('maker','メーカー')}{field('model_number','型番')}</div><div className="two">{field('purchase_date','購入日','date')}{field('warranty_until','保証期限','date')}</div><div className="two">{field('shop','購入店')}{field('price','価格','number')}</div>{field('storage_place','保管場所')}{field('manual_url','説明書URL','url')}{area('consumables_memo','消耗品メモ')}{area('free_memo','自由メモ')}{field('tags','タグ（スペース・カンマ区切り）')}<CheckField label="お気に入り" checked={data.favorite} onChange={v=>setData({...data,favorite:v})}/>
    </>}
  </div><div className="modal-actions"><button className="ghost" onClick={onClose}>キャンセル</button><button className="save" onClick={()=>{ if(type==='note'&&!data.title.trim()) return alert('タイトルを入力してください。'); if(type==='item'&&!data.name.trim()) return alert('品名を入力してください。'); onSave(type,data,file,removeImage)}}>保存</button></div></div></div>
}
function SelectField({label,value,options,onChange}){return <label className="field"><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o}>{o}</option>)}</select></label>}
function CheckField({label,checked,onChange}){return <label className="check"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/>{label}</label>}

function DetailModal({detail,image,onClose,onEdit,onDelete}){
  const d=detail.data; const note=detail.type==='note'
  const rows=note?[['カテゴリ',d.category],['タグ',(d.tags||[]).join(' / ')],['本文',d.body],['手順',d.steps],['注意点',d.caution],['参考URL',d.reference_url],['登録日',fmtDateTime(d.created_at)],['更新日',fmtDateTime(d.updated_at)]]:[['カテゴリ',d.category],['所持状況',d.status],['メーカー',d.maker],['型番',d.model_number],['購入日',d.purchase_date],['購入店',d.shop],['価格',d.price!=null?`${Number(d.price).toLocaleString()}円`:''],['保証期限',d.warranty_until],['保管場所',d.storage_place],['説明書URL',d.manual_url],['消耗品メモ',d.consumables_memo],['自由メモ',d.free_memo],['タグ',(d.tags||[]).join(' / ')],['登録日',fmtDateTime(d.created_at)],['更新日',fmtDateTime(d.updated_at)]]
  return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>{note?d.title:d.name}</h2><button onClick={onClose}>×</button></div><div className="modal-body">{image&&<img className="detail-image" src={image} alt="登録画像"/>}{rows.filter(x=>x[1]!==''&&x[1]!=null).map(([k,v])=><div className="detail-row" key={k}><strong>{k}</strong>{String(k).includes('URL')?<a href={v} target="_blank" rel="noreferrer">{v}</a>:<span className={['本文','手順','注意点','消耗品メモ','自由メモ'].includes(k)?'pre':''}>{v||'—'}</span>}</div>)}</div><div className="modal-actions"><button className="danger" onClick={onDelete}>削除</button><button className="save" onClick={onEdit}>編集</button></div></div></div>
}

function Settings({session,notes,items,busy,syncText,loadAll,onExport,onImport,onSignOut}){
  return <><Section title="アカウント"><div className="settings-card"><div>ログイン中</div><strong>{session.user.email}</strong><button className="ghost" onClick={onSignOut}>ログアウト</button></div></Section><Section title="同期"><div className="settings-card"><p>☁ {syncText}</p><button className="save" disabled={busy} onClick={loadAll}>最新データを取得</button></div></Section><Section title="データ"><div className="settings-card"><p>小ネタ：{notes.length}件　持ち物：{items.length}件</p><button className="save" onClick={onExport}>JSONバックアップを書き出す</button><label className="file-button">JSONから復元 / 旧v1データを移行<input type="file" accept="application/json,.json" onChange={e=>{const f=e.target.files?.[0];if(f)onImport(f);e.target.value=''}}/></label><p className="hint">v2ではSupabaseが正データです。JSONはバックアップ・旧データ移行用です。</p></div></Section></>
}

function ImportModal({preview,onClose,onApply}){
  const p=preview.preview
  return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>JSON復元・移行</h2><button onClick={onClose}>×</button></div><div className="modal-body"><p>小ネタ：{preview.raw.notes.length}件<br/>持ち物：{preview.raw.items.length}件</p><div className="summary-grid"><span>新規追加</span><strong>{p.add}</strong><span>更新候補</span><strong>{p.update}</strong><span>現在側が新しい/同じ</span><strong>{p.skip}</strong></div><p className="hint">差分復元では、JSON側が新しいデータだけ更新し、現在側だけにあるデータは残します。</p></div><div className="modal-actions wrap"><button className="ghost" onClick={onClose}>キャンセル</button><button className="ghost" onClick={()=>onApply('merge')}>追加で復元</button><button className="save" onClick={()=>onApply('diff')}>差分復元</button><button className="danger" onClick={()=>{if(confirm('現在のSupabaseデータを全消去して復元します。よろしいですか？'))onApply('replace')}}>全消去して復元</button></div></div></div>
}

function AuthScreen(){
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false)
  async function signIn(){setBusy(true);const {error}=await supabase.auth.signInWithPassword({email,password});setBusy(false);if(error)alert(error.message)}
  async function signUp(){setBusy(true);const {data,error}=await supabase.auth.signUp({email,password});setBusy(false);if(error)return alert(error.message);alert(data.session?'アカウントを作成し、ログインしました。':'アカウントを作成しました。確認メールが有効な場合はメールを確認してください。')}
  return <div className="auth-shell"><div className="auth-card"><div className="eyebrow">クラウド共有版 v{APP_VERSION}</div><h1>思い出しメモ</h1><p>同じアカウントでPC・iPad・iPhoneから同じデータを利用できます。</p><label className="field"><span>メールアドレス</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="field"><span>パスワード</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="save wide" disabled={busy||!email||!password} onClick={signIn}>ログイン</button><button className="ghost wide" disabled={busy||!email||password.length<6} onClick={signUp}>初回アカウント作成</button><p className="hint">個人利用前提。データはRLSでログインユーザー本人のみに制限します。</p></div></div>
}
function SetupMissing(){return <div className="auth-shell"><div className="auth-card"><h1>Supabase設定が必要です</h1><p><code>VITE_SUPABASE_URL</code> と <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> が未設定です。</p><p>READMEの「Supabase設定手順」を確認してください。</p></div></div>}

function normalizeImport(raw){
  if(!raw||typeof raw!=='object') throw new Error('バックアップ形式が不正です。')
  const now=new Date().toISOString()
  const notes=(Array.isArray(raw.notes)?raw.notes:[]).map(n=>({id:String(n.id||uuid()),legacy_id:n.legacy_id||(!isUuid(n.id)?String(n.id||''):null),title:String(n.title||''),category:String(n.category||'その他'),tags:parseTags(n.tags),photo:String(n.photo||''),body:String(n.body||''),steps:String(n.steps||''),caution:String(n.caution||''),reference_url:String(n.reference_url??n.url??''),favorite:Boolean(n.favorite),created_at:n.created_at||n.createdAt||now,updated_at:n.updated_at||n.updatedAt||now}))
  const items=(Array.isArray(raw.items)?raw.items:[]).map(i=>({id:String(i.id||uuid()),legacy_id:i.legacy_id||(!isUuid(i.id)?String(i.id||''):null),name:String(i.name||''),category:String(i.category||'その他'),maker:String(i.maker||''),model_number:String(i.model_number??i.modelNumber??''),purchase_date:String(i.purchase_date??i.purchaseDate??''),shop:String(i.shop||''),price:i.price??'',warranty_until:String(i.warranty_until??i.warrantyUntil??''),storage_place:String(i.storage_place??i.storagePlace??''),manual_url:String(i.manual_url??i.manualUrl??''),consumables_memo:String(i.consumables_memo??i.consumablesMemo??''),free_memo:String(i.free_memo??i.freeMemo??''),tags:parseTags(i.tags),status:normalizeStatus(i.status??i.ownershipStatus??i.condition),favorite:Boolean(i.favorite),photo:String(i.photo||''),created_at:i.created_at||i.createdAt||now,updated_at:i.updated_at||i.updatedAt||now}))
  return {notes,items}
}
function computePreview(data,notes,items){ let add=0,update=0,skip=0; for(const [list,current] of [[data.notes,notes],[data.items,items]]) for(const r of list){const c=current.find(x=>x.id===r.id||(r.legacy_id&&x.legacy_id===r.legacy_id));if(!c)add++;else if(new Date(r.updated_at).getTime()>new Date(c.updated_at).getTime())update++;else skip++} return {add,update,skip} }
function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})}
function dataUrlToBlob(dataUrl){const [head,b64]=dataUrl.split(',');const mime=(head.match(/data:(.*?);base64/)||[])[1]||'image/jpeg';const bin=atob(b64||'');const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new Blob([bytes],{type:mime})}
function mimeExt(m){return m.includes('png')?'png':m.includes('webp')?'webp':m.includes('heic')?'heic':'jpg'}

export default App
