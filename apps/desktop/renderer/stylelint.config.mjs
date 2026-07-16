export default {
  extends: ['stylelint-config-standard-scss'],
  customSyntax: 'postcss-scss',
  ignoreFiles: ['dist/**'],
  rules: {
    // Keep the initial rollout focused on correctness. Formatting and selector
    // migrations can be enabled separately without forcing a repository-wide
    // SCSS rewrite as part of the theme work.
    'alpha-value-notation': null,
    'color-function-alias-notation': null,
    'color-function-notation': null,
    'color-hex-length': null,
    'color-no-hex': true,
    'custom-property-empty-line-before': null,
    'declaration-empty-line-before': null,
    'declaration-block-no-redundant-longhand-properties': null,
    'declaration-no-important': true,
    'declaration-property-value-keyword-no-deprecated': null,
    'font-family-name-quotes': null,
    'function-disallowed-list': ['rgb', 'rgba'],
    'function-url-quotes': null,
    'hue-degree-notation': null,
    'import-notation': null,
    'keyframes-name-pattern': null,
    'length-zero-no-unit': null,
    'media-feature-range-notation': null,
    'max-nesting-depth': [2, { ignore: ['blockless-at-rules'] }],
    'no-descending-specificity': null,
    'number-max-precision': null,
    'property-no-vendor-prefix': null,
    'property-no-deprecated': null,
    'rule-empty-line-before': null,
    'selector-class-pattern': null,
    'selector-id-pattern': null,
    'selector-max-specificity': '0,4,2',
    'selector-not-notation': null,
    'selector-pseudo-element-colon-notation': null,
    'shorthand-property-no-redundant-values': null,
    'scss/operator-no-newline-after': null,
    'value-keyword-case': null,
  },
  overrides: [
    {
      files: [
        '**/design-system/tokens.scss',
        '**/features/_settings-appearance.scss',
      ],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
      },
    },
    {
      files: ['**/base.scss', '**/popover.scss'],
      rules: {
        'declaration-no-important': null,
      },
    },
  ],
}
