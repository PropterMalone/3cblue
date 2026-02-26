// pattern: Imperative Shell
import { describe, expect, it } from "vitest";
import { parseCardNames } from "./deck-validation.js";

describe("parseCardNames", () => {
	it("parses one card per line", () => {
		const names = parseCardNames(
			"Lightning Bolt\nSnapcaster Mage\nDelver of Secrets",
		);
		expect(names).toEqual([
			"Lightning Bolt",
			"Snapcaster Mage",
			"Delver of Secrets",
		]);
	});

	it("ignores blank lines and comments", () => {
		const names = parseCardNames(
			"Lightning Bolt\n\n// my deck\nSnapcaster Mage\n  \nDelver of Secrets",
		);
		expect(names).toEqual([
			"Lightning Bolt",
			"Snapcaster Mage",
			"Delver of Secrets",
		]);
	});

	it("trims whitespace", () => {
		const names = parseCardNames(
			"  Lightning Bolt  \n  Snapcaster Mage  \n  Delver  ",
		);
		expect(names).toEqual(["Lightning Bolt", "Snapcaster Mage", "Delver"]);
	});
});
