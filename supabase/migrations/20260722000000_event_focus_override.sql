-- Manual override for an event's derived focus. The focus (hiring / client / neither) is normally
-- inferred from tags + format by eventFocus(); this column lets a human correct a bad match after the
-- fact. Values: 'hiring' | 'client' | 'neither'. NULL = auto (fall back to the keyword classifier).
alter table event add column if not exists focus_override text;
