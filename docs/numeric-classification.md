# Numeric map classes

New or deliberately rebuilt **Ranges** classes accept finite numbers and plain decimal text, including signs and exponents. They do not remove less-than/greater-than signs, infer decimal commas or thousands separators, or turn blank text into zero. Laboratory codes and nonnumeric values remain unchanged in the source data and keep the layer's own style. Negative numbers remain numbers; vendor-specific missing-value sentinels are not inferred.

The controls show how many observations are excluded, including blanks, and offer **Use unique values** to classify the original strings instead. Drill traces do not count as additional observations. A field with no usable numbers produces no numeric classes.

Saved classifications without a `numericPolicy` retain their original interpretation and export appearance. Changing a colour, label, upper limit or point size does not alter that policy. **Rebuild using plain numbers**, or deliberately rebuilding by changing the attribute, method or number of classes, writes `numericPolicy: "finite-decimal-v1"`. Review the rebuilt classes before exporting. The policy travels with the saved project; classification itself does not rewrite raw feature properties.

This is a display classification rule, not an assay calculation or a treatment for below-detection-limit observations. It does not infer detection limits, units or analytical validity. Existing categorical classification limits still apply.
