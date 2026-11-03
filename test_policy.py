from policy import Policy, Guard

GOOD = "merchant.testnet"


def make(**kw):
    return Guard(Policy(max_per_tx=5, max_per_day=10, allowlist=[GOOD], **kw))


def test_allows_normal_payment():
    assert make().check(GOOD, 2).allowed


def test_blocks_over_per_tx_cap():
    d = make().check(GOOD, 6)
    assert not d.allowed and "per-transaction" in d.reason


def test_blocks_unknown_receiver():
    d = make().check("scammer.testnet", 1)
    assert not d.allowed and "allowlist" in d.reason


def test_blocks_over_daily_cap():
    g = make()
    assert g.check(GOOD, 5, now=1000).allowed
    assert g.check(GOOD, 5, now=1001).allowed
    d = g.check(GOOD, 1, now=1002)
    assert not d.allowed and "daily" in d.reason


def test_daily_cap_rolls_off_after_24h():
    g = make()
    g.check(GOOD, 5, now=1000)
    g.check(GOOD, 5, now=1001)
    assert g.check(GOOD, 5, now=1000 + 86401).allowed


def test_blocklist_wins_over_allowlist():
    g = Guard(Policy(allowlist=[GOOD], blocklist=[GOOD]))
    assert not g.check(GOOD, 1).allowed


def test_rejects_non_positive_amount():
    assert not make().check(GOOD, 0).allowed
    assert not make().check(GOOD, -3).allowed
