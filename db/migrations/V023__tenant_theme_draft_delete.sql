-- Authored by hand (not generated): publishing a draft clears that draft (Command_Contracts_and_QA, publish step 9: "Clear
-- matching draft only"), so the control-plane role may delete a draft row. Only the draft table opens up: a published
-- version, a review and the pointer keep the grants of V019.
GRANT DELETE ON TABLE machvon.tenant_theme_draft TO machvon_control;
