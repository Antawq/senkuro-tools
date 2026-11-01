import { beforeEach, describe, expect, it } from 'vitest';

import { childWithClass, placeBeforeAny } from '../utils/shared/dom';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('childWithClass', () => {
  it('finds a direct child by class and ignores a deeper one', () => {
    document.body.innerHTML = '<div id="parent"><div><span class="mark"></span></div><b class="mark" id="direct"></b></div>';
    expect(childWithClass(document.querySelector('#parent') as Element, 'mark')?.id).toBe('direct');
    expect(childWithClass(document.querySelector('#direct') as Element, 'mark')).toBeUndefined();
  });
});

describe('placeBeforeAny', () => {
  const parent = () => document.querySelector('#parent') as HTMLElement;
  const node = () => document.querySelector('#node') as HTMLElement;
  const order = () => [...parent().children].map((child) => child.id);

  it('appends the node when none of the later controls is there', () => {
    document.body.innerHTML = '<div id="parent"><b id="node"></b><i id="site"></i><u id="extra"></u></div>';
    placeBeforeAny(parent(), node(), ['.later']);
    expect(order()).toEqual(['site', 'extra', 'node']);
  });

  it('puts the node before the first later control, whichever kind it is', () => {
    document.body.innerHTML = '<div id="parent"><i id="site"></i><s id="b" class="second"></s><s id="a" class="first"></s><b id="node"></b></div>';
    placeBeforeAny(parent(), node(), ['.first', '.second']);
    expect(order()).toEqual(['site', 'node', 'b', 'a']);
  });

  it('appends the node when there are no later controls to name', () => {
    document.body.innerHTML = '<div id="parent"><b id="node"></b><i id="site"></i></div>';
    placeBeforeAny(parent(), node(), []);
    expect(order()).toEqual(['site', 'node']);
  });

  it('ignores a later control that is not a direct child', () => {
    document.body.innerHTML = '<div id="parent"><div><s class="later"></s></div><b id="node"></b></div>';
    placeBeforeAny(parent(), node(), ['.later']);
    expect(node().nextElementSibling).toBeNull();
  });

  it('changes nothing when the node already stands where it belongs', () => {
    document.body.innerHTML = '<div id="parent"><i id="site"></i><b id="node"></b><s id="later" class="later"></s></div>';
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((mutations) => records.push(...mutations));
    observer.observe(parent(), { childList: true });
    placeBeforeAny(parent(), node(), ['.later']);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    document.body.innerHTML = '<div id="parent"><i id="site"></i><b id="node"></b></div>';
    const lastRecords = new MutationObserver(() => undefined);
    lastRecords.observe(parent(), { childList: true });
    placeBeforeAny(parent(), node(), ['.later']);
    expect(lastRecords.takeRecords()).toEqual([]);
    lastRecords.disconnect();
  });
});
