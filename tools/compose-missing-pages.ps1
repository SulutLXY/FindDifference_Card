$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$path = Join-Path $root 'assets/scene/game.scene'
$scene = [System.Collections.ArrayList]@(Get-Content -Raw $path | ConvertFrom-Json)
if ($scene | Where-Object { $_.'__type__' -eq 'cc.Node' -and $_._name -eq 'AdModal' }) { throw 'AdModal already exists' }

function Id { [Convert]::ToBase64String([Guid]::NewGuid().ToByteArray()).TrimEnd('=').Replace('+','A').Replace('/','B') }
function NodeId([string]$name) { for($i=0;$i -lt $scene.Count;$i++){if($scene[$i].'__type__'-eq'cc.Node' -and $scene[$i]._name -eq $name){return $i}};throw "missing $name" }
function Child([int]$parent,[string]$name) { foreach($r in $scene[$parent]._children){$i=[int]$r.'__id__';if($scene[$i]._name -eq $name){return $i}};throw "missing $name" }
function Comp([int]$node,[string]$type) { foreach($r in $scene[$node]._components){$c=$scene[[int]$r.'__id__'];if($c.'__type__'-eq$type){return $c}};return $null }
function Frame([string]$name){$m=Get-Content -Raw (Join-Path $root "assets/resources/textures/$name.png.meta")|ConvertFrom-Json;($m.subMetas.PSObject.Properties.Value|Where-Object importer -eq 'sprite-frame'|Select-Object -First 1).uuid}
function Clone($source,[int]$node){$c=$source|ConvertTo-Json -Depth 100|ConvertFrom-Json;$c.node.'__id__'=$node;$c._id=Id;return $c}
$uiTemplate=Comp (NodeId 'BG_Lobby') 'cc.UITransform'
$spriteTemplate=Comp (NodeId 'BG_Lobby') 'cc.Sprite'
$labelTemplate=Comp (NodeId 'Subtitle') 'cc.Label'
function Make([string]$name,[int]$parent,[double]$x,[double]$y,[double]$w,[double]$h,[bool]$active=$true){
  $id=$scene.Count;$n=[pscustomobject]@{'__type__'='cc.Node';'_name'=$name;'_objFlags'=0;'__editorExtras__'=[pscustomobject]@{};'_parent'=[pscustomobject]@{'__id__'=$parent};'_children'=@();'_active'=$active;'_components'=@();'_prefab'=$null;'_lpos'=[pscustomobject]@{'__type__'='cc.Vec3';x=$x;y=$y;z=0};'_lrot'=[pscustomobject]@{'__type__'='cc.Quat';x=0;y=0;z=0;w=1};'_lscale'=[pscustomobject]@{'__type__'='cc.Vec3';x=1;y=1;z=1};'_mobility'=0;'_layer'=33554432;'_euler'=[pscustomobject]@{'__type__'='cc.Vec3';x=0;y=0;z=0};'_id'=(Id)}
  [void]$scene.Add($n);$ci=$scene.Count;$c=Clone $uiTemplate $id;$c._contentSize.width=$w;$c._contentSize.height=$h;[void]$scene.Add($c);$n._components=@([pscustomobject]@{'__id__'=$ci});$scene[$parent]._children+= [pscustomobject]@{'__id__'=$id};return $id
}
function AddSprite([int]$id,[string]$uuid,[bool]$sliced=$false,[int[]]$rgba=@(255,255,255,255)){$ci=$scene.Count;$c=Clone $spriteTemplate $id;$c._spriteFrame=[pscustomobject]@{'__uuid__'=$uuid;'__expectedType__'='cc.SpriteFrame'};$c._type=if($sliced){1}else{0};$c._color.r=$rgba[0];$c._color.g=$rgba[1];$c._color.b=$rgba[2];$c._color.a=$rgba[3];[void]$scene.Add($c);$scene[$id]._components+= [pscustomobject]@{'__id__'=$ci}}
function AddLabel([int]$id,[string]$value,[int]$size,[int[]]$rgb=@(65,72,95)){$ci=$scene.Count;$c=Clone $labelTemplate $id;$c._string=$value;$c._fontSize=$size;$c._actualFontSize=$size;$c._lineHeight=[int]($size*1.25);$c._color.r=$rgb[0];$c._color.g=$rgb[1];$c._color.b=$rgb[2];$c._color.a=255;[void]$scene.Add($c);$scene[$id]._components+= [pscustomobject]@{'__id__'=$ci}}
function LabelNode([string]$name,[int]$parent,[string]$value,[int]$size,[double]$x,[double]$y,[double]$w,[double]$h,[int[]]$rgb=@(65,72,95)){$id=Make $name $parent $x $y $w $h;AddLabel $id $value $size $rgb;return $id}
function SpriteNode([string]$name,[int]$parent,[string]$uuid,[double]$x,[double]$y,[double]$w,[double]$h,[bool]$sliced=$false,[int[]]$rgba=@(255,255,255,255)){$id=Make $name $parent $x $y $w $h;AddSprite $id $uuid $sliced $rgba;return $id}
function Skin([int]$node,[string]$uuid,[bool]$sliced=$true){$s=Comp $node 'cc.Sprite';if($s){$s._spriteFrame=[pscustomobject]@{'__uuid__'=$uuid;'__expectedType__'='cc.SpriteFrame'};$s._type=if($sliced){1}else{0};$s._color.r=255;$s._color.g=255;$s._color.b=255;$s._color.a=255}else{AddSprite $node $uuid $sliced}}
function Block([int]$id){$ci=$scene.Count;$c=[pscustomobject]@{'__type__'='cc.BlockInputEvents';'_name'='';'_objFlags'=0;'__editorExtras__'=[pscustomobject]@{};node=[pscustomobject]@{'__id__'=$id};'_enabled'=$true;'__prefab'=$null;'_id'=(Id)};[void]$scene.Add($c);$scene[$id]._components+= [pscustomobject]@{'__id__'=$ci}}

$bgContent=Frame 'UI_Sprite/V3/backgrounds/bg_content';$panel=Frame 'UI_Sprite/V3/panels/panel_light';$panelSelected=Frame 'UI_Sprite/V3/panels/panel_selected';$levelCard=Frame 'UI_Sprite/V3/panels/level_card';$primary=Frame 'UI_Sprite/V3/buttons/button_primary_normal';$secondary=Frame 'UI_Sprite/V3/buttons/button_secondary_normal';$square=Frame 'UI_Sprite/V3/buttons/button_square_normal';$lock=Frame 'UI_Sprite/V3/icons/icon_lock';$back=Frame 'UI_Sprite/V3/icons/icon_back';$hero=Frame 'level-01/scene-a';$other=Frame 'scene_top';$white=Frame 'UI_Sprite/BG_White'

# Selection page: five editor-visible cards. Only text/lock state is refreshed in script.
$select=NodeId 'LevelSelect';$list=Child $select 'List';$bg=Child $select 'LevelSelectBG';Skin $bg $bgContent $false
$title=LabelNode 'PageTitle' $select '选择关卡' 48 0 572 520 80
$backButton=Child $select 'BtnBack';Skin $backButton $square;$backLabel=Child $backButton 'Label';(Comp $backLabel 'cc.Label')._string='';[void](SpriteNode 'IconBack' $backButton $back 0 0 42 42)
$scene[$list]._children=@()
$names=@('皇家城堡庭院','王室宴会厨房','炼金术士实验室','骑士团武器库','巨龙宝库')
for($n=1;$n -le 5;$n++){
  $x=if($n%2 -eq 1){-168}else{168};$row=[math]::Floor(($n-1)/2);$y=315-$row*350
  $card=SpriteNode "Card$n" $list $levelCard $x $y 310 315 $true
  $thumb=SpriteNode 'Thumbnail' $card $(if($n-eq 1){$hero}else{$other}) 0 38 282 194 $false $(if($n-eq 1){@(255,255,255,255)}else{@(135,145,160,255)})
  [void](LabelNode 'CardNumber' $card "第$n`关" 26 -85 126 120 44)
  [void](LabelNode 'CardName' $card $names[$n-1] 26 0 -82 275 45)
  [void](LabelNode 'CardDetail' $card $(if($n-eq 1){'☆☆☆  8处差异'}else{'通关上一关后解锁'}) 20 0 -125 280 40)
  $lockNode=SpriteNode 'LockIcon' $card $lock 0 36 74 74
  $scene[$lockNode]._active=($n-ne 1)
}
$scene[$select]._children=@([pscustomobject]@{'__id__'=$bg},[pscustomobject]@{'__id__'=$title},[pscustomobject]@{'__id__'=$backButton},[pscustomobject]@{'__id__'=$list})

# Result card and dimmer are scene assets, behind the original interactive nodes.
$result=NodeId 'ResultModal';$old=@($scene[$result]._children);$dim=SpriteNode 'ResultDimmer' $result $white 0 0 750 1334 $true @(58,66,82,180);Block $dim
$card=SpriteNode 'ResultCard' $result $panelSelected 0 0 600 655 $true
$scene[$result]._children=@([pscustomobject]@{'__id__'=$dim},[pscustomobject]@{'__id__'=$card})+$old
foreach($pair in @(@('BtnRevive',$primary),@('BtnPrimary',$primary),@('BtnHome',$secondary),@('BtnShare',$secondary))){$id=Child $result $pair[0];Skin $id $pair[1]}
$resultTitle=Child $result 'Title';(Comp $resultTitle 'cc.Label')._color.r=65;(Comp $resultTitle 'cc.Label')._color.g=72;(Comp $resultTitle 'cc.Label')._color.b=95
$resultSummary=Child $result 'Summary';(Comp $resultSummary 'cc.Label')._color.r=105;(Comp $resultSummary 'cc.Label')._color.g=116;(Comp $resultSummary 'cc.Label')._color.b=137

# H5 ad simulation uses the same light nine-slice language and remains hidden in editor.
$canvas=NodeId 'Canvas';$ad=Make 'AdModal' $canvas 0 0 750 1334 $false
$adDim=SpriteNode 'AdDimmer' $ad $white 0 0 750 1334 $true @(58,66,82,180);Block $adDim
$adCard=SpriteNode 'AdCard' $ad $panel 0 0 600 635 $true
[void](LabelNode 'AdTitle' $adCard '广告演示' 48 0 240 500 76)
[void](LabelNode 'AdNote' $adCard 'H5 开发环境模拟激励视频' 24 0 175 520 48 @(105,116,137))
[void](LabelNode 'AdTimer' $adCard '5' 100 0 35 280 140 @(147,100,57))
[void](LabelNode 'AdStatus' $adCard '广告播放中，请稍候…' 27 0 -75 510 60)
foreach($entry in @(@('CloseAd','关闭广告',-142),@('ReturnAd','返回游戏',142))){$button=SpriteNode $entry[0] $ad $secondary $entry[2] -230 248 82 $true;[void](LabelNode 'Label' $button $entry[1] 28 0 0 230 70);$scene[$button]._parent=[pscustomobject]@{'__id__'=$adCard};$scene[$ad]._children=@($scene[$ad]._children|Where-Object{[int]$_.'__id__'-ne$button});$scene[$adCard]._children+= [pscustomobject]@{'__id__'=$button}}
[IO.File]::WriteAllText($path,($scene|ConvertTo-Json -Depth 100)+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
"Composed five level cards, result modal and H5 ad modal. Serialized objects: $($scene.Count)"
