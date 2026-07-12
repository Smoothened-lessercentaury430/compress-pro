/**
 * HI-01…04: the universal home intake — `/` accepts any file type, parks what
 * belongs on the default (jpg) tab and routes everything else straight to its
 * tool, so a first-time visitor never has to pick a tab. Tool pages keep their
 * converter semantics (covered by the rest of the suite via gotoTab).
 */
import { expect, fx, test } from '../fixtures';
import { gotoPath, rows, upload } from '../helpers';

test('HI-01: picking a PNG on / routes to /compress-png with the file parked @smoke', async ({
	page
}) => {
	await gotoPath(page, '/');
	await expect(page.getByText('Drop any files here')).toBeVisible();
	await expect(page.getByText('the right tool opens automatically')).toBeVisible();
	await upload(page, fx('graphic-alpha.png'));
	await expect(page).toHaveURL(/\/compress-png$/);
	await expect(rows(page)).toHaveCount(1);
	await expect(rows(page).first()).toContainText('graphic-alpha.png');
});

test('HI-02: a JPG picked on / parks on the home tab', async ({ page }) => {
	await gotoPath(page, '/');
	await upload(page, fx('exif-gps.jpg'));
	await expect(rows(page)).toHaveCount(1);
	await expect(rows(page).first()).toContainText('exif-gps.jpg');
	await expect(page).not.toHaveURL(/compress/);
});

test('HI-03: a mixed pick parks the JPG here and the PNG on its own tab', async ({ page }) => {
	await gotoPath(page, '/');
	// raw setInputFiles: the upload() helper asserts all picked files land as
	// rows HERE, but on home the PNG routes to its own tab.
	await page
		.locator('input[type=file]')
		.setInputFiles([fx('exif-gps.jpg'), fx('graphic-alpha.png')]);
	// jpg parked on the home tab; the PNG parks on /compress-png WITHOUT
	// navigating (something parked here), so its chip badge shows the count.
	await expect(rows(page)).toHaveCount(1);
	await expect(rows(page).first()).toContainText('exif-gps.jpg');
	await expect(page).not.toHaveURL(/compress/);
	await expect(page.locator('[data-seg="png"]')).toContainText('1');
});

test('HI-04: an unknown type on / shows the unsupported banner and stays', async ({ page }) => {
	await gotoPath(page, '/');
	await page.setInputFiles('input[type=file]', {
		name: 'strange.xyz',
		mimeType: 'application/octet-stream',
		buffer: Buffer.from('not a real file')
	});
	await expect(page.getByTestId('error-banner')).toContainText('Unsupported file type');
	await expect(page).not.toHaveURL(/compress/);
	await expect(rows(page)).toHaveCount(0);
});
