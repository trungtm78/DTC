/// A typed request body. Generated classes implement it; `jsonEncode` calls `toJson` on nested models.
abstract interface class RequestModel {
  /// The wire form: JSON member names as the contract spells them, optional members that are null left out.
  Map<String, Object?> toJson();
}
