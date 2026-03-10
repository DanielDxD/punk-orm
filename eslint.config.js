import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    // Disables all ESLint rules that could conflict with Prettier.
    // Prettier handles formatting; ESLint handles code quality only.
    eslintConfigPrettier,
    {
        rules: {
            quotes: ["error", "double", { avoidEscape: true }],
            semi: ["error", "always"],
            "@typescript-eslint/interface-name-prefix": "off",
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/explicit-member-accessibility": [
                "error",
                {
                    accessibility: "explicit",
                    overrides: {
                        accessors: "explicit",
                        constructors: "explicit",
                        methods: "explicit",
                        properties: "explicit",
                        parameterProperties: "explicit"
                    }
                }
            ],
            "@typescript-eslint/array-type": ["error", { default: "generic" }],
            "@typescript-eslint/no-empty-function": ["error", { allow: ["constructors"] }]
        }
    }
);
