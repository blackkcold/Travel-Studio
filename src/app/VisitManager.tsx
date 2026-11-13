import { useEffect, useMemo, useState } from 'react';
import { applyVisitCommand, newId, remapVisitOrder, remapVisitSelection, type ProjectDocument, type SelectionRecipe, type VisitManagementCommand, type VisitOrder, type VisitRecord } from '../domain';
import { evaluateSelection, formatTimeEvidence, freezeJourney, parseTimeEvidence } from '../journey';
import { Badge, Button, Checkbox, Field, Modal, Segmented, Select, SourcedField, Switch, TaskFeedback } from '../ui';
import './VisitManager.css';

interface Props {
  project: ProjectDocument; recipe: SelectionRecipe; order: VisitOrder; initialVisitId?: string;
  onClose: () => void; onApply: (command: VisitManagementCommand, expectedRevision: number) => void;
}
const sourceLabels = { exif: '照片 EXIF', user: '用户确认', provider: '服务提供', unknown: '来源未知' };

/** A reviewable explicit command, separate from grouping and selection. */
export function VisitManager({ project, recipe, order, initialVisitId, onClose, onApply }: Props) {
  const library = project.library;
  const [kind, setKind] = useState<'merge' | 'split' | 'time'>('merge');
  const [anchorId, setAnchorId] = useState(initialVisitId ?? order.orderedVisitIds[0] ?? library.visits[0]?.id ?? '');
  const anchor = library.visits.find(visit => visit.id === anchorId);
  const [mergeIds, setMergeIds] = useState<string[]>([anchorId]), [timeSourceId, setTimeSourceId] = useState(anchorId);
  const [photoIds, setPhotoIds] = useState<string[]>([]), [overrideTime, setOverrideTime] = useState(false);
  const [date, setDate] = useState(''), [clock, setClock] = useState(''), [timeDirty, setTimeDirty] = useState(false), [error, setError] = useState('');
  const [identity] = useState(() => ({ at: new Date().toISOString(), operationId: newId('visit-command'), newVisitId: newId('visit') }));
  const name = (visit: VisitRecord) => visit.label || library.places.find(place => place.id === visit.placeId)?.name || '待定位到访';
  const label = (visit: VisitRecord) => { const firstPhoto = library.photos.find(photo => photo.id === visit.photoIds[0]); return `${name(visit)} · ${formatTimeEvidence(visit.time)} · ${visit.photoIds.length} 张${firstPhoto ? ` · ${firstPhoto.name}` : ''}`; };
  const candidates = library.visits.filter(visit => visit.placeId === anchor?.placeId);
  const selectedSources = candidates.filter(visit => mergeIds.includes(visit.id));

  useEffect(() => {
    setMergeIds([anchorId]); setTimeSourceId(anchorId); setPhotoIds([]); setOverrideTime(false); setTimeDirty(false); setError('');
    setDate(anchor?.time.value?.slice(0, 10) ?? ''); setClock(anchor?.time.value?.includes('T') ? anchor.time.value.slice(11, 19) : '');
  }, [anchorId]);

  const preview = useMemo(() => {
    try {
      if (!anchor) throw new Error('请先选择一条到访记录。');
      const editedTime = parseTimeEvidence(date ? `${date}${clock ? `T${clock.length === 5 ? `${clock}:00` : clock}` : ''}` : undefined, undefined, 'user');
      let command: VisitManagementCommand;
      if (kind === 'merge') command = { kind, visitIds: mergeIds, targetVisitId: anchor.id, timeSourceVisitId: timeSourceId, ...identity };
      else if (kind === 'split') command = { kind, visitId: anchor.id, photoIds, ...(overrideTime ? { time: editedTime } : {}), ...identity };
      else { if (!timeDirty) throw new Error('修改下方日期或时刻后，可保存这次时间修正。'); command = { kind, visitId: anchor.id, time: editedTime, ...identity }; }
      const result = applyVisitCommand(library, command), nextRecipe = remapVisitSelection(recipe, result), nextOrder = remapVisitOrder(order, result);
      const selected = evaluateSelection(result.library, nextRecipe), journey = freezeJourney({ ...project, library: result.library }, nextRecipe, nextOrder);
      return { command, result, selected, journey, error: '' };
    } catch (value) { return { error: (value as Error).message }; }
  }, [project, recipe, order, anchor, kind, mergeIds, timeSourceId, photoIds, overrideTime, date, clock, timeDirty, identity]);
  const currentSelection = evaluateSelection(library, recipe);
  const changeKind = (next: typeof kind) => { setKind(next); setError(''); };
  const toggleMerge = (id: string, checked: boolean) => {
    setMergeIds(ids => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id));
    if (!checked && timeSourceId === id) setTimeSourceId(anchorId);
  };
  const apply = () => {
    if (!preview.command) return;
    try { onApply(preview.command, project.revision); onClose(); } catch (value) { setError((value as Error).message); }
  };
  const timeFields = <div className="two-columns">
    <Field label="到访日期"><input type="date" value={date} onChange={event => { setDate(event.target.value); setTimeDirty(true); }}/></Field>
    <Field label="到访时刻（可留空）"><input type="time" step="1" value={clock} onChange={event => { setClock(event.target.value); setTimeDirty(true); }}/></Field>
  </div>;

  return <Modal title="管理到访记录" onClose={onClose} wide>
    <div className="visit-manager">
      <div className="visit-manager-form">
        <Segmented label="到访管理操作" value={kind} onChange={changeKind} options={[{ value: 'merge', label: '合并到访' }, { value: 'split', label: '拆分照片' }, { value: 'time', label: '修正时间' }]}/>
        <Select label={kind === 'merge' ? '保留的到访身份与顺序位置' : '要调整的到访'} value={anchorId} onChange={setAnchorId} options={library.visits.map(visit => ({ value: visit.id, label: label(visit) }))}/>
        {kind === 'merge' && <>
          <p className="help-text">勾选同一地点的到访，明确合并为一次。返程记录默认各自保留；地名相同不会自动合并。</p>
          <div className="visit-manager-list" aria-label="选择要合并的到访">{candidates.map(visit => <label className="visit-manager-row" key={visit.id}>
            <Checkbox aria-label={`合并 ${label(visit)}`} checked={mergeIds.includes(visit.id)} disabled={visit.id === anchorId} onChange={event => toggleMerge(visit.id, event.target.checked)}/>
            <span><strong>{name(visit)}</strong><small>{formatTimeEvidence(visit.time)} · {visit.photoIds.length} 张照片</small></span>
            {visit.id === anchorId && <Badge>保留身份</Badge>}
          </label>)}</div>
          {candidates.length < 2 && <p className="help-text">当前地点只有一次到访，无需合并。选择有重复到访的地点后可继续。</p>}
          <Select label="合并后使用哪次到访的时间" value={timeSourceId} onChange={setTimeSourceId} options={selectedSources.map(visit => ({ value: visit.id, label: label(visit) }))}/>
          {selectedSources.find(visit => visit.id === timeSourceId) && <SourcedField label="保留的时间证据" value={formatTimeEvidence(selectedSources.find(visit => visit.id === timeSourceId)!.time)} source={sourceLabels[selectedSources.find(visit => visit.id === timeSourceId)!.time.source]}/>}
        </>}
        {kind === 'split' && <>
          <p className="help-text">勾选移到新到访的照片，并为原到访至少保留一张。新到访在自定义顺序中紧随原到访。</p>
          <div className="visit-manager-list" aria-label="选择要拆出的照片">{anchor?.photoIds.map(id => { const photo = library.photos.find(photo => photo.id === id); return <label className="visit-manager-row" key={id}>
            <Checkbox aria-label={`拆出照片 ${photo?.name ?? id}`} checked={photoIds.includes(id)} onChange={event => setPhotoIds(ids => event.target.checked ? [...ids, id] : ids.filter(value => value !== id))}/>
            <span><strong>{photo?.name ?? id}</strong><small>{photo ? formatTimeEvidence(photo.time) : '照片资料缺失'}</small></span>
          </label>; })}</div>
          {(anchor?.photoIds.length ?? 0) < 2 && <p className="help-text">这次到访不足两张照片。需要记录另一站时，可使用“添加一站”。</p>}
          <Switch label="为新到访单独填写时间" checked={overrideTime} onChange={setOverrideTime}/>
          {overrideTime ? timeFields : anchor && <SourcedField label="新到访保留原时间证据" value={formatTimeEvidence(anchor.time)} source={sourceLabels[anchor.time.source]}/>}
        </>}
        {kind === 'time' && <>
          {anchor && <SourcedField label="当前到访时间" value={formatTimeEvidence(anchor.time)} source={sourceLabels[anchor.time.source]}/>}
          {timeFields}
          <p className="help-text">只修正到访时间，照片 EXIF 保留原值。只填日期会保留日期精度；日期留空表示时间未知。填写的时刻作为本地时间，不推定时区。</p>
        </>}
      </div>
      <div className="visit-manager-preview" aria-live="polite">
        <span className="eyebrow">操作预览</span>
        {preview.result && preview.selected && preview.journey ? <>
          <h3>{kind === 'merge' ? `${mergeIds.length} 次到访合并为 1 次` : kind === 'split' ? `${photoIds.length} 张照片移到独立到访` : '保留原始证据，记录时间修正'}</h3>
          <dl><div><dt>资料库到访</dt><dd>{library.visits.length} → {preview.result.library.visits.length}</dd></div><div><dt>照片资料</dt><dd>{library.photos.length} 张，全部保留</dd></div><div><dt>当前入选照片</dt><dd>{currentSelection.counts.photos} → {preview.selected.counts.photos}</dd></div></dl>
          {currentSelection.counts.photos !== preview.selected.counts.photos && <p className="notice">无照片到访的选入/排除状态将转为合并后照片的逐张状态，手动排除仍优先。上方数量为应用后的结果。</p>}
          <h3>应用后的当前顺序</h3><ol>{preview.journey.order.orderedVisitIds.map((id, index) => { const visit = preview.journey.resolvedVisits.find(visit => visit.id === id)!; return <li key={id}><span>{index + 1}</span>{visit.name}<small>{formatTimeEvidence(visit.time)}</small></li>; })}</ol>
          {preview.journey.order.unresolvedVisitIds.length > 0 && <p className="help-text">另有 {preview.journey.order.unresolvedVisitIds.length} 次到访待排序，未补造时刻。</p>}
        </> : <p className="help-text">{preview.error}</p>}
        <p className="help-text">这会更新资料库，已有作品仍保留各自快照。操作可撤销，原始到访和时间来源会记入历史。</p>
      </div>
    </div>
    {error && <TaskFeedback error={error}/>}
    <div className="modal-actions"><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!preview.command} onClick={apply}>{kind === 'merge' ? '应用合并' : kind === 'split' ? '应用拆分' : '保存时间修正'}</Button></div>
  </Modal>;
}
