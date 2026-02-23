import type { AppScreenshot } from '@rocket.chat/core-typings';
import { css } from '@rocket.chat/css-in-js';
import { Box, Icon } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import ScreenshotCarousel from './ScreenshotCarousel';

type ScreenshotCarouselAnchorProps = {
	screenshots: AppScreenshot[];
};

type voidFunction = () => void;

const ScreenshotCarouselAnchor = ({ screenshots }: ScreenshotCarouselAnchorProps): ReactElement => {
	const { t } = useTranslation();

	const [viewCarousel, setViewCarousel] = useState(false);

	const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

	const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);

	const { length } = screenshots;

	const isFirstSlide = currentSlideIndex === 0;
	const isLastSlide = currentSlideIndex === length - 1;

	const isCarouselVisible = Boolean(viewCarousel && screenshots.length > 0);

	const handleNextSlide = (): void => {
		setCurrentSlideIndex(currentSlideIndex + 1);
	};

	const handlePrevSlide = (): void => {
		setCurrentSlideIndex(currentSlideIndex - 1);
	};

	const handleKeyboardKey = useCallback(
		(onKeyDownEvent: KeyboardEvent): void => {
			const keysObject: Record<string, voidFunction> = {
				ArrowLeft: () => setCurrentSlideIndex((prevSlideIndex) => (prevSlideIndex !== 0 ? prevSlideIndex - 1 : 0)),
				ArrowRight: () => setCurrentSlideIndex((prevSlideIndex) => (prevSlideIndex !== length - 1 ? prevSlideIndex + 1 : length - 1)),
				Escape: () => setViewCarousel(false),
			};

			const keyHandler = keysObject[onKeyDownEvent.key];

			if (!keyHandler) {
				return;
			}

			onKeyDownEvent.preventDefault();
			keyHandler();
		},
		[length],
	);

	useEffect(() => {
		if (length <= 1) {
			return;
		}

		const intervalId = setInterval(() => {
			setCurrentPreviewIndex((prevIndex) => {
				if (prevIndex === length - 1) return 0;

				return prevIndex + 1;
			});
		}, 5000);

		return (): void => {
			clearInterval(intervalId);
		};
	}, [length]);

	useEffect(() => {
		if (!isCarouselVisible) {
			return;
		}

		document.addEventListener('keydown', handleKeyboardKey);

		return (): void => {
			document.removeEventListener('keydown', handleKeyboardKey);
		};
	}, [handleKeyboardKey, isCarouselVisible]);

	const carouselPortal = createPortal(
		<ScreenshotCarousel
			AppScreenshots={screenshots}
			setViewCarousel={setViewCarousel}
			handleNextSlide={handleNextSlide}
			handlePrevSlide={handlePrevSlide}
			isFirstSlide={isFirstSlide}
			isLastSlide={isLastSlide}
			currentSlideIndex={currentSlideIndex}
		/>,
		document.body,
	);

	return (
		<>
			<Box
				is='button'
				type='button'
				onClick={(): void => setViewCarousel(true)}
				display='flex'
				flexDirection='column'
				maxWidth='x640'
				width='100%'
				style={{
					cursor: 'pointer',
					border: 'none',
					padding: 0,
					background: 'transparent',
					textAlign: 'left',
				}}
				aria-label={t('Open_screenshot_carousel')}
			>
				<Box
					is='img'
					src={screenshots[currentPreviewIndex]?.accessUrl}
					alt='App preview image'
					className={[
						css`
							transition: filter 0.2s ease;
							&:hover {
								filter: brightness(90%);
							}
						`,
					]}
				/>

				<Box display='flex' flexDirection='row' bg='tint' pi={16} pb={10} alignItems='center'>
					<Icon name='image' size='x24' mie={8} />{' '}
					<Box is='span' fontScale='p2m' color='default'>
						{currentPreviewIndex + 1} of {screenshots.length}
					</Box>
				</Box>
			</Box>
			{isCarouselVisible && carouselPortal}
		</>
	);
};

export default ScreenshotCarouselAnchor;
