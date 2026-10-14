from bt.analytics.event_study import classify, market_model


def test_market_model_recovers_alpha_and_beta():
    rm = [0.01, -0.02, 0.015, 0.003, -0.007, 0.02, -0.01]
    ri = [0.0005 + 1.5 * x for x in rm]
    alpha, beta, sigma = market_model(ri, rm)
    assert abs(alpha - 0.0005) < 1e-12 and abs(beta - 1.5) < 1e-12 and sigma < 1e-12


def test_classify_separates_news_from_scheduled_changes():
    assert classify("BOARD_JOIN", "Jill Beggs appointed (Class III; audit).", False) == "appointed"
    assert classify("BOARD_JOIN", "Alfred F. Kelly, Jr. elected at the 2014 annual meeting.", False) == "elected"
    assert classify("BOARD_LEAVE", "Zients does not stand for re-election; term ends at the 2020 annual meeting.",
                    False) == "not_standing"
    assert classify("BOARD_LEAVE", "Cohler resigns (notice 2019-07-23), effective 2019-07-24.", False) == "resigned"
    assert classify("BOARD_JOIN", "Andy Jassy joins the board on becoming President and CEO.", False) == "exec_change"
    assert classify("BOARD_LEAVE", "Steps down.", True) == "exec_change"
