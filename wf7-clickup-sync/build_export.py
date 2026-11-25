import json,uuid
DOC={"__rl":True,"mode":"id","value":"10jERabFE3D8G1W_53Y11V2ad7vc8Af1kgXCjya5jIjM"}
sh=lambda n:{"__rl":True,"mode":"name","value":n}
GS={"googleSheetsOAuth2Api":{"name":"Google Sheets account"}}
CU={"clickUpApi":{"name":"ClickUp account"}}
API='https://api.clickup.com/api/v2'
nodes=[];conn={}
def N(name,typ,ver,params,pos,**kw):
    n={"id":str(uuid.uuid4()),"name":name,"type":typ,"typeVersion":ver,"position":pos,"parameters":params};n.update(kw);nodes.append(n);return name
def C(a,b,out=0):
    conn.setdefault(a,{"main":[]});m=conn[a]["main"]
    while len(m)<=out:m.append([])
    m[out].append({"node":b,"type":"main","index":0})
code=lambda name,f,pos:N(name,'n8n-nodes-base.code',2,{"mode":"runOnceForAllItems","language":"javaScript","jsCode":open(f).read()},pos)
def noop(name,pos,left='={{ $json._noop }}'):
    return N(name,'n8n-nodes-base.if',2.2,{"conditions":{"options":{"caseSensitive":True,"leftValue":"","typeValidation":"loose"},"conditions":[{"leftValue":left,"operator":{"type":"boolean","operation":"true","singleValue":True},"rightValue":""}],"combinator":"and"}},pos)
def http(name,url,body,pos):
    return N(name,'n8n-nodes-base.httpRequest',4.2,{"method":"POST","url":url,"authentication":"predefinedCredentialType","nodeCredentialType":"clickUpApi","sendBody":True,"contentType":"json","specifyBody":"json","jsonBody":body,"options":{"batching":{"batch":{"batchSize":1,"batchInterval":700}}}},pos,retryOnFail=True,maxTries=3,waitBetweenTries=5000,onError="continueRegularOutput",credentials=CU)
N('Weekdays hourly 08:20-19:20','n8n-nodes-base.scheduleTrigger',1.4,{"rule":{"interval":[{"field":"cronExpression","expression":"20 8-19 * * 1-5"}]}},[0,0])
N('Manual Test','n8n-nodes-base.manualTrigger',1,{},[0,192])
N('Config','n8n-nodes-base.set',3.4,{"mode":"manual","assignments":{"assignments":[{"id":"cfg-list","name":"list_id","value":"1100520000006922","type":"string"},{"id":"cfg-dry","name":"dry_run","value":True,"type":"boolean"},{"id":"cfg-over","name":"overwrite_hand_filled","value":False,"type":"boolean"},{"id":"cfg-only","name":"only_lead_ids","value":"","type":"string"},{"id":"cfg-max","name":"max_comments_per_run","value":80,"type":"number"}]}},[224,96])
N('Read Leads','n8n-nodes-base.googleSheets',4.7,{"resource":"sheet","operation":"read","documentId":DOC,"sheetName":sh('Leads'),"options":{}},[448,96],executeOnce=True,credentials=GS)
N('Read Actions','n8n-nodes-base.googleSheets',4.7,{"resource":"sheet","operation":"read","documentId":DOC,"sheetName":sh('Actions'),"options":{}},[672,96],executeOnce=True,alwaysOutputData=True,credentials=GS)
N('Get Fields','n8n-nodes-base.httpRequest',4.2,{"method":"GET","url":'='+API+'/list/{{ $("Config").first().json.list_id }}/field',"authentication":"predefinedCredentialType","nodeCredentialType":"clickUpApi","options":{}},[896,96],executeOnce=True,credentials=CU)
N('Get Tasks','n8n-nodes-base.httpRequest',4.2,{"method":"GET","url":'='+API+'/list/{{ $("Config").first().json.list_id }}/task',"authentication":"predefinedCredentialType","nodeCredentialType":"clickUpApi","sendQuery":True,"specifyQuery":"keypair","queryParameters":{"parameters":[{"name":"include_closed","value":"true"},{"name":"subtasks","value":"false"}]},"options":{"pagination":{"pagination":{"paginationMode":"updateAParameterInEachRequest","parameters":{"parameters":[{"type":"qs","name":"page","value":"={{ $pageCount }}"}]},"paginationCompleteWhen":"other","completeExpression":"={{ $response.body.last_page !== false || !($response.body.tasks || []).length }}","limitPagesFetched":True,"maxRequests":30,"requestInterval":700}}}},[1120,96],executeOnce=True,credentials=CU)
code('Plan sync','plan.js',[1344,96]);code('New tasks','creates.js',[1568,96]);noop('Nothing to create?',[1792,96])
http('Create task','='+API+'/list/{{ $("Config").first().json.list_id }}/task','={{ JSON.stringify($json.body) }}',[2016,176])
code('Field changes','fieldwrites.js',[2240,96]);noop('No field changes?',[2464,96])
http('Set field','='+API+'/task/{{ $json.task_id }}/field/{{ $json.field_id }}','={{ JSON.stringify($json.body) }}',[2688,176])
code('Comments to post','comments.js',[2912,96]);noop('No comments?',[3136,96])
http('Post comment','='+API+'/task/{{ $json.task_id }}/comment','={{ JSON.stringify({ comment_text: $json.comment_text, notify_all: false }) }}',[3360,176])
code('Synced rows','synced.js',[3584,176]);noop('Nothing to mark?',[3808,176])
N('Mark action synced','n8n-nodes-base.googleSheets',4.7,{"resource":"sheet","operation":"update","documentId":DOC,"sheetName":sh('Actions'),"columns":{"mappingMode":"autoMapInputData","value":{},"matchingColumns":["row_number"],"schema":[]},"options":{"cellFormat":"RAW","handlingExtraData":"insertInNewColumn"}},[4032,240],onError="continueRegularOutput",credentials=GS)
code('Run summary','summary.js',[4256,96]);noop('Worth logging?',[4480,96],'={{ $json.log }}')
cols=['Timestamp','Workflow','Lead ID','Company','Step','Input','Output','Reason']
N('Log run','n8n-nodes-base.googleSheets',4.7,{"resource":"sheet","operation":"append","documentId":DOC,"sheetName":sh('Log'),"columns":{"mappingMode":"defineBelow","value":{"Timestamp":"={{ $now.toISO() }}","Workflow":"WF7 ClickUp sync","Lead ID":"","Company":"","Step":'={{ $("Plan sync").first().json.dry_run ? "ClickUp sync (dry run)" : "ClickUp sync" }}',"Input":'={{ $("Run summary").first().json.input }}',"Output":'={{ $("Run summary").first().json.output }}',"Reason":'={{ $("Run summary").first().json.reason }}'},"schema":[{"id":c,"displayName":c,"required":False,"defaultMatch":False,"display":True,"type":"string","canBeUsedToMatch":False} for c in cols]},"options":{"cellFormat":"RAW"}},[4704,96],onError="continueRegularOutput",credentials=GS)
N('Any write failed?','n8n-nodes-base.if',2.2,{"conditions":{"options":{"caseSensitive":True,"leftValue":"","typeValidation":"loose"},"conditions":[{"leftValue":'={{ $("Run summary").first().json.failed }}',"operator":{"type":"number","operation":"gt"},"rightValue":0}],"combinator":"and"}},[4928,96])
N('Stop: ClickUp writes failed','n8n-nodes-base.stopAndError',1,{"errorMessage":'={{ "WF7 ClickUp sync: " + $("Run summary").first().json.output + " " + $("Run summary").first().json.errors.slice(0, 3).join(" | ") }}'},[5152,96])
N('Note: ClickUp sync','n8n-nodes-base.stickyNote',1,{"content":"## WF7 ClickUp sync\nReads Leads and Actions, updates the ClickUp list \"Mail Atılan Kurumlar – Müşteri Listesi\". One task per company (second-contact rows L123-B go to the parent task). Match: Lead ID field, then email, then exact name.\n\n**Config node**\n- dry_run true = plan only, nothing written (see Run summary output)\n- overwrite_hand_filled false = the 8 fields Nil filled by hand are only filled when empty; differences are listed, not written\n- only_lead_ids = comma list for a test on a few companies\n\nEach new Actions row becomes a dated comment; the row then gets a ClickUp Comment ID so it is posted once.","color":4},[2512,368])
for a,b in [('Weekdays hourly 08:20-19:20','Config'),('Manual Test','Config'),('Config','Read Leads'),('Read Leads','Read Actions'),('Read Actions','Get Fields'),('Get Fields','Get Tasks'),('Get Tasks','Plan sync'),('Plan sync','New tasks'),('New tasks','Nothing to create?'),('Create task','Field changes'),('Field changes','No field changes?'),('Set field','Comments to post'),('Comments to post','No comments?'),('Post comment','Synced rows'),('Synced rows','Nothing to mark?'),('Mark action synced','Run summary'),('Run summary','Worth logging?'),('Worth logging?','Log run'),('Log run','Any write failed?'),('Any write failed?','Stop: ClickUp writes failed')]: C(a,b)
for i,(t,f) in {'Nothing to create?':('Field changes','Create task'),'No field changes?':('Comments to post','Set field'),'No comments?':('Run summary','Post comment'),'Nothing to mark?':('Run summary','Mark action synced')}.items(): C(i,t,0);C(i,f,1)
wf={"name":"Texprove WF7 - ClickUp sync","nodes":nodes,"connections":conn,"settings":{"executionOrder":"v1","timezone":"Europe/Istanbul","errorWorkflow":"sZJSgJf9658Bdip7"}}
json.dump(wf,open("../WF7-clickup-sync.json",'w'),ensure_ascii=False,indent=2);print(len(nodes))
